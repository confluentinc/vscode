import path from "node:path";
import * as vscode from "vscode";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import { logError } from "../../errors";
import { Logger } from "../../logging";
import { CloudProvider, EnvironmentId, IEnvProviderRegion } from "../../models/resource";
import {
  showErrorNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "../../notifications";
import { cloudProviderRegionQuickPick } from "../../quickpicks/cloudProviderRegions";
import { flinkCcloudEnvironmentQuickPick } from "../../quickpicks/environments";
import { getSidecar } from "../../sidecar";
import { readFileBuffer } from "../../utils/fsWrappers";
import { uploadFileToAzure } from "./uploadToAzure";
import { uploadFileToS3 } from "./uploadToS3";
export { uploadFileToAzure };

export interface UDFUploadParams {
  environment: string;
  cloud: string;
  region: string;
  artifactName: string;
  fileFormat: string;
  selectedFile: vscode.Uri;
}

const logger = new Logger("commands/uploadUDF");

/**
 * Read a file from a VS Code Uri and prepare a Blob (and File if available).
 */
export async function prepareUploadFileFromUri(uri: vscode.Uri): Promise<{
  blob: Blob;
  contentType: string;
}> {
  try {
    const bytes: Uint8Array = await readFileBuffer(uri);
    const ext: string = path.extname(uri.fsPath).toLowerCase();

    const contentType: string =
      ext === ".jar" ? "application/java-archive" : "application/octet-stream";

    const blob: Blob = new Blob([bytes], { type: contentType });

    return { blob, contentType };
  } catch (err) {
    logError(err, `Failed to read file from URI: ${uri.toString()}`);
    showErrorNotificationWithButtons(`Failed to read file: ${uri.fsPath}. See logs for details.`);
    throw err;
  }
}

/**
 * Requests a presigned upload URL for a Flink artifact using the sidecar.
 * @param request PresignedUploadUrlArtifactV1PresignedUrlRequest
 * @returns The presigned URL response object, or undefined if the request fails.
 */
export async function getPresignedUploadUrl(
  request: PresignedUploadUrlArtifactV1PresignedUrlRequest,
): Promise<PresignedUploadUrlArtifactV1PresignedUrl200Response> {
  const sidecarHandle = await getSidecar();
  const providerRegion: IEnvProviderRegion = {
    environmentId: request.environment as EnvironmentId,
    provider: request.cloud,
    region: request.region,
  };
  const presignedClient = sidecarHandle.getFlinkPresignedUrlsApi(providerRegion);

  const urlResponse = await presignedClient.presignedUploadUrlArtifactV1PresignedUrl({
    PresignedUploadUrlArtifactV1PresignedUrlRequest: request,
  });
  return urlResponse;
}

export async function promptForUDFUploadParams(): Promise<UDFUploadParams | undefined> {
  const environment = await flinkCcloudEnvironmentQuickPick();

  if (!environment || !environment.id) {
    void showErrorNotificationWithButtons("Upload UDF cancelled: Environment ID is required.");
    return undefined;
  }

  const cloudRegion = await cloudProviderRegionQuickPick((region) => region.cloud !== "GCP");

  if (!cloudRegion) {
    void showErrorNotificationWithButtons("Upload UDF cancelled: Cloud provider is required.");
    return undefined;
  }

  let cloud: CloudProvider;
  if (cloudRegion.provider === "AZURE") {
    cloud = CloudProvider.Azure;
  } else if (cloudRegion.provider === "AWS") {
    cloud = CloudProvider.AWS;
  } else {
    void showErrorNotificationWithButtons(
      `Upload UDF cancelled: Unsupported cloud provider: ${cloudRegion.provider}`,
    );
    return undefined;
  }

  const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
    openLabel: "Select",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "Flink Artifact Files": ["jar"],
    },
  });
  if (!selectedFiles || selectedFiles.length === 0) {
    // if the user cancels the file selection, silently exit
    return;
  }

  const selectedFile: vscode.Uri = selectedFiles[0];
  const fileFormat: string = selectedFiles[0].fsPath.split(".").pop()!;

  const artifactName = await vscode.window.showInputBox({
    prompt: "Enter the artifact name for the UDF",
    ignoreFocusOut: true,
    validateInput: (value) => (value ? undefined : "Artifact name is required"),
  });

  if (!artifactName) {
    void showWarningNotificationWithButtons("Upload UDF cancelled: Artifact name is required.");
    return undefined;
  }

  return {
    environment: environment.id,
    cloud,
    region: cloudRegion.region,
    artifactName,
    fileFormat,
    selectedFile,
  };
}

export async function handleUploadFile(
  params: UDFUploadParams,
  presignedURL: PresignedUploadUrlArtifactV1PresignedUrl200Response,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Uploading ${params.artifactName}:`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Preparing file..." });
      const { blob, contentType } = await prepareUploadFileFromUri(params.selectedFile);

      logger.info(`Starting file upload for cloud provider: ${params.cloud}`, {
        artifactName: params.artifactName,
        environment: params.environment,
        cloud: params.cloud,
        region: params.region,
        contentType,
      });

      switch (params.cloud) {
        case CloudProvider.Azure: {
          progress.report({ message: "Uploading to Azure storage..." });
          logger.debug("Uploading to Azure storage");
          const response = await uploadFileToAzure({
            file: blob,
            presignedUrl: presignedURL.upload_url!,
            contentType,
          });

          logger.info(`Azure upload completed for artifact "${params.artifactName}"`, {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            artifactName: params.artifactName,
            environment: params.environment,
            cloud: params.cloud,
            region: params.region,
          });
          break;
        }
        case CloudProvider.AWS: {
          progress.report({ message: "Uploading to AWS storage..." });
          logger.debug("Uploading to AWS storage");

          // build required form data for api request
          const uploadFormData = presignedURL.upload_form_data as Record<string, string>;

          if (!uploadFormData) {
            throw new Error("AWS upload form data is missing from presigned URL response");
          }

          const response = await uploadFileToS3({
            file: blob,
            presignedUrl: presignedURL.upload_url!,
            contentType,
            uploadFormData,
          });

          logger.info(`AWS upload completed for artifact "${params.artifactName}"`, {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            artifactName: params.artifactName,
            environment: params.environment,
            cloud: params.cloud,
            region: params.region,
          });
          break;
        }
      }
    },
  );
}
