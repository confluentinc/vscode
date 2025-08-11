import path from "node:path";
import * as vscode from "vscode";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import { logError } from "../../errors";
import { Logger } from "../../logging";
import { EnvironmentId, IEnvProviderRegion } from "../../models/resource";
import {
  showErrorNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "../../notifications";
import { flinkCcloudEnvironmentQuickPick } from "../../quickpicks/environments";
import { getSidecar } from "../../sidecar";
import { uploadFileToAzure } from "./uploadToAzure";

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
  selectedFile?: vscode.Uri; // Optional, used for file selection
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

  const blob: Blob = new Blob([bytes], { type: contentType });

  // File may not exist in the VS Code extension host (Node 18). Use Blob if not.
  let file: File | undefined;
  try {
    if (typeof File !== "undefined") {
      file = new File([blob], filename, { type: contentType, lastModified: Date.now() });
    }
  } catch {
    // ignore – fall back to Blob
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

    // Wrap the request as required by the OpenAPI client
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
  const cloud = await vscode.window.showQuickPick(["AWS", "Azure"], {
    placeHolder: "Select the cloud provider for the UDF upload",
  });
  if (!cloud) {
    showErrorNotificationWithButtons("Upload UDF cancelled: Cloud provider is required.");
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
  // NOTE: Build the upload body later (right before fetch) via prepareUploadFileFromUri(selectedFile).

  // extract the file extension (format) from the selected file
  const fileFormat: string = selectedFiles[0].fsPath.split(".").pop()!;

  const region = await vscode.window.showInputBox({
    prompt: "Enter the region for the UDF upload",
    ignoreFocusOut: true,
    validateInput: (value) => (value ? undefined : "Region is required"),
  });

  if (!region) {
    showWarningNotificationWithButtons("Upload UDF cancelled: Region is required.");
    return undefined;
  }

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
    region,
    artifactName,
    fileFormat,
    selectedFile: selectedFile ? selectedFile : undefined,
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

  switch (params.cloud) {
    // TODO: TS ENUMS FOR CLOUD PROVIDERS
    case "Azure": {
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
        supportedProviders: ["Azure"],
        requestedProvider: params.cloud,
      });
      showErrorNotificationWithButtons(`Unsupported cloud provider: ${params.cloud}`);
  }
}
