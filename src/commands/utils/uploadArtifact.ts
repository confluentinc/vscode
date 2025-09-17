import path from "path";
import * as vscode from "vscode";
import {
  CreateArtifactV1FlinkArtifact201Response,
  CreateArtifactV1FlinkArtifactRequest,
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import { artifactsChanged } from "../../emitters";
import { logError } from "../../errors";
import { Logger } from "../../logging";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { CCloudKafkaCluster } from "../../models/kafkaCluster";
import {
  CloudProvider,
  EnvironmentId,
  IEnvProviderRegion,
  IProviderRegion,
} from "../../models/resource";
import { showErrorNotificationWithButtons } from "../../notifications";
import { cloudProviderRegionQuickPick } from "../../quickpicks/cloudProviderRegions";
import { flinkCcloudEnvironmentQuickPick } from "../../quickpicks/environments";
import { getSidecar } from "../../sidecar";
import { readFileBuffer } from "../../utils/fsWrappers";
import { uploadFileToAzure, uploadFileToS3 } from "./uploadToProvider";
export { uploadFileToAzure };

export interface ArtifactUploadParams {
  environment: string;
  cloud: string;
  region: string;
  artifactName: string;
  fileFormat: string;
  selectedFile: vscode.Uri;
}

const logger = new Logger("commands/uploadArtifact");

const MAX_FILE_SIZE = 100 * 1024 * 1024; // sets the max file size to 100 MB in 104,857,600 bytes

export const PRESIGNED_URL_LOCATION = "PRESIGNED_URL_LOCATION";

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

    const safeBytes = new Uint8Array(bytes);
    const blob: Blob = new Blob([Buffer.from(safeBytes)], { type: contentType });
    if (blob.size > MAX_FILE_SIZE) {
      const errorMessage = `File size ${(blob.size / (1024 * 1024)).toFixed(
        2,
      )}MB exceeds the maximum allowed size of 100MB. Please use a smaller file.`;
      logger.warn("File too large", { fileSize: blob.size });
      throw new Error(errorMessage);
    }
    return { blob, contentType };
  } catch (err) {
    logError(err, `Failed to read file from URI: ${uri.toString()}`);
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

export async function promptForArtifactUploadParams(
  item?: CCloudKafkaCluster | CCloudFlinkComputePool | vscode.Uri,
): Promise<ArtifactUploadParams | undefined> {
  const isCcloudItem =
    item && (item instanceof CCloudFlinkComputePool || item instanceof CCloudKafkaCluster);
  if (isCcloudItem) {
    logger.debug("Starting upload artifact using provided context", {
      environment: item.environmentId,
      cloud: item.provider,
      region: item.region,
    });
  }
  // Use the item's environment if provided, otherwise prompt for it
  const environment =
    isCcloudItem && item.environmentId
      ? { id: item.environmentId }
      : await flinkCcloudEnvironmentQuickPick();

  // Use the item's provider and region if exists, otherwise prompt for it
  let cloudRegion: IProviderRegion | undefined;
  if (isCcloudItem) {
    cloudRegion = { provider: item.provider, region: item.region };
  } else {
    cloudRegion = await cloudProviderRegionQuickPick((region) => region.cloud !== "GCP");
  }

  if (!environment || !environment.id || !cloudRegion) {
    return undefined;
  }

  let cloud: CloudProvider;
  if (cloudRegion.provider === "AZURE") {
    cloud = CloudProvider.Azure;
  } else if (cloudRegion.provider === "AWS") {
    cloud = CloudProvider.AWS;
  } else {
    void showErrorNotificationWithButtons(
      `Upload Artifact cancelled: Unsupported cloud provider: ${cloudRegion.provider}`,
    );
    return undefined;
  }

  // If the incoming item is a Uri, use it; otherwise prompt the user
  let selectedFile: vscode.Uri | undefined;
  if (item && item instanceof vscode.Uri) {
    selectedFile = item;
  } else {
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
      return undefined;
    }

    selectedFile = selectedFiles[0];
  }

  const fileFormat: string = selectedFile.fsPath.split(".").pop() ?? "";

  // Default artifact name to the selected file's base name (without extension), but allow override.
  const defaultArtifactName = path.basename(selectedFile.fsPath, path.extname(selectedFile.fsPath));

  const artifactName = await vscode.window.showInputBox({
    prompt: "Enter the artifact name",
    value: defaultArtifactName,
    ignoreFocusOut: true,
    validateInput: (value) => (value && value.trim() ? undefined : "Artifact name is required"),
  });

  if (!artifactName) {
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

export async function handleUploadToCloudProvider(
  params: ArtifactUploadParams,
  presignedURL: PresignedUploadUrlArtifactV1PresignedUrl200Response,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Uploading ${params.artifactName}`,
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

export async function uploadArtifactToCCloud(
  params: ArtifactUploadParams,
  uploadId: string,
): Promise<CreateArtifactV1FlinkArtifact201Response | undefined> {
  try {
    const createRequest = buildCreateArtifactRequest(params, uploadId);

    logger.info("Creating Flink artifact", {
      artifactName: params.artifactName,
      environment: params.environment,
      cloud: params.cloud,
      region: params.region,
      uploadId,
      requestPayload: createRequest,
    });

    const sidecarHandle = await getSidecar();
    const providerRegion: IEnvProviderRegion = {
      environmentId: params.environment as EnvironmentId,
      provider: params.cloud,
      region: params.region,
    };
    const artifactsClient = sidecarHandle.getFlinkArtifactsApi(providerRegion);

    const response = await artifactsClient.createArtifactV1FlinkArtifact({
      CreateArtifactV1FlinkArtifactRequest: createRequest,
      cloud: params.cloud,
      region: params.region,
    });

    logger.info("Flink artifact created successfully", {
      artifactId: response.id,
      artifactName: params.artifactName,
    });

    artifactsChanged.fire(providerRegion);

    return response;
  } catch (error) {
    let extra: Record<string, unknown> = {
      cloud: params.cloud,
      region: params.region,
    };
    logError(error, "Failed to create Flink artifact in Confluent Cloud", { extra });
    throw error;
  }
}

export function buildCreateArtifactRequest(
  params: ArtifactUploadParams,
  uploadId: string,
): CreateArtifactV1FlinkArtifactRequest {
  return {
    cloud: params.cloud,
    region: params.region,
    environment: params.environment,
    display_name: params.artifactName,
    content_format: params.fileFormat.toUpperCase(),
    upload_source: {
      location: PRESIGNED_URL_LOCATION,
      upload_id: uploadId,
    },
  };
}
