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
import { uploadFileToAzure } from "./uploadToAzure";
export { uploadFileToAzure };

/**
 * Prompts the user for environment, cloud provider, region, and artifact name.
 * Returns an object with these values, or undefined if the user cancels.
 */
export interface UDFUploadParams {
  environment: string;
  cloud: string;
  region: string;
  artifactName: string;
  fileFormat: string;
  selectedFile?: vscode.Uri;
}

const logger = new Logger("commands/uploadUDF");

/**
 * Read a file from a VS Code Uri and prepare a Blob (and File if available).
 */
export async function prepareUploadFileFromUri(uri: vscode.Uri): Promise<{
  blob: Blob;
  file: File | undefined;
  filename: string;
  contentType: string;
  size: number;
}> {
  const bytes: Uint8Array = await vscode.workspace.fs.readFile(uri);
  const filename: string = path.basename(uri.fsPath);
  const ext: string = path.extname(filename).toLowerCase();

  const contentType: string =
    ext === ".zip"
      ? "application/zip"
      : ext === ".jar"
        ? "application/java-archive"
        : "application/octet-stream";

  const blob: Blob = new Blob([new Uint8Array(bytes)], { type: contentType });

  // File may not exist in the VS Code extension host (Node 18). Use Blob if not.
  let file: File | undefined;
  if (typeof File !== "undefined") {
    file = new File([blob], filename, { type: contentType, lastModified: Date.now() });
  }

  return { blob, file, filename, contentType, size: blob.size };
}

/**
 * Requests a presigned upload URL for a Flink artifact using the sidecar.
 * @param request PresignedUploadUrlArtifactV1PresignedUrlRequest
 * @returns The presigned URL response object, or undefined if the request fails.
 */
export async function getPresignedUploadUrl(
  request: PresignedUploadUrlArtifactV1PresignedUrlRequest,
): Promise<PresignedUploadUrlArtifactV1PresignedUrl200Response | undefined> {
  try {
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
  } catch (err) {
    logError(err, "Failed to get presigned upload URL");
    return undefined;
  }
}

/**
 * Handles the presigned URL request and shows appropriate notifications.
 * @param request The presigned upload URL request
 */
export async function handlePresignedUrlRequest(
  request: PresignedUploadUrlArtifactV1PresignedUrlRequest,
): Promise<string | undefined> {
  const response = await getPresignedUploadUrl(request);
  if (response && response.upload_url) {
    return response.upload_url;
  } else {
    showErrorNotificationWithButtons("Failed to get presigned upload URL. See logs for details.");
  }
}

export async function promptForUDFUploadParams(): Promise<UDFUploadParams | undefined> {
  const environment = await flinkCcloudEnvironmentQuickPick();

  if (!environment || !environment.id) {
    showErrorNotificationWithButtons("Upload UDF cancelled: Environment ID is required.");
    return undefined;
  }

  // Use cloudProviderRegionQuickPick to select cloud and region together
  const cloudRegion = await cloudProviderRegionQuickPick((region) => region.cloud !== "GCP");
  if (!cloudRegion) {
    showErrorNotificationWithButtons("Upload UDF cancelled: Cloud provider is required.");
    return undefined;
  }

  // Ensure cloud is always set to the enum value. For the future: Add upload call to AWS
  let cloud: CloudProvider;
  switch (cloudRegion.provider) {
    case CloudProvider.Azure:
      cloud = CloudProvider.Azure;
      break;
    case CloudProvider.AWS:
      cloud = CloudProvider.AWS;
      break;
    default:
      showErrorNotificationWithButtons("Upload UDF cancelled: Unsupported cloud provider.");
      return undefined;
  }

  const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
    openLabel: "Select",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "Flink Artifact Files": ["zip", "jar"],
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
    showWarningNotificationWithButtons("Upload UDF cancelled: Artifact name is required.");
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
  presignedURL: string,
): Promise<void> {
  if (!params.selectedFile) {
    showErrorNotificationWithButtons("No file selected for upload.");
    return;
  }
  const { file, blob, contentType } = await prepareUploadFileFromUri(params.selectedFile);

  logger.info(`Starting file upload for cloud provider: ${params.cloud}`, {
    artifactName: params.artifactName,
    environment: params.environment,
    cloud: params.cloud,
    region: params.region,
    contentType,
  });

  // Now only need to check the enum, since promptForUDFUploadParams guarantees enum value
  switch (params.cloud) {
    case CloudProvider.Azure: {
      logger.debug("Uploading to Azure storage");
      const response = await uploadFileToAzure({
        file: file ?? blob,
        presignedUrl: presignedURL,
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
    default:
      logger.error(`Unsupported cloud provider: ${params.cloud}`, {
        supportedProviders: [CloudProvider.Azure],
        requestedProvider: params.cloud,
      });
      showErrorNotificationWithButtons(`Unsupported cloud provider: ${params.cloud}`);
  }
}
