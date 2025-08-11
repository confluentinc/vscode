import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts/models";
import { logError } from "../errors";
import { Logger } from "../logging";
import { showErrorNotificationWithButtons } from "../notifications";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { uploadFileToAzure } from "./utils/uploadToAzure";
import {
  handlePresignedUrlRequest,
  prepareUploadFileFromUri,
  promptForUDFUploadParams,
  UDFUploadParams,
} from "./utils/uploadUDF";

const logger = new Logger("commands/uploadUDF");

/**
 * Prompts the user for environment, cloud provider, region, and artifact name.
 * Returns an object with these values, or undefined if the user cancels.
 */

export async function uploadUDFCommand(): Promise<void> {
  if (!hasCCloudAuthSession()) {
    return;
  }
  try {
    const params = await promptForUDFUploadParams();
    if (!params) {
      return;
    }

    const request: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      environment: params.environment,
      cloud: params.cloud,
      region: params.region,
      id: params.artifactName,
      content_format: params.fileFormat,
    };

    const uploadUrl = await handlePresignedUrlRequest(request);

    if (!uploadUrl) {
      showErrorNotificationWithButtons("Failed to get presigned upload URL. See logs for details.");
      return;
    }

    await handleUploadFile(params, uploadUrl);
    vscode.window.showInformationMessage(
      `UDF artifact "${params.artifactName}" uploaded successfully!`,
    );
  } catch (err) {
    logError(err, "Failed to execute Upload UDF command");
    showErrorNotificationWithButtons(
      "An error occurred while uploading UDF. See logs for details.",
    );
  }
}

async function handleUploadFile(params: UDFUploadParams, presignedURL: string): Promise<void> {
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
/**
 * Registers the "confluent.uploadUDF" command with logging.
 * Note: this is a placeholder, the final command will register and upload the UDF in a clean sweep.
 */
export function registerUploadUDFCommand(): vscode.Disposable {
  return registerCommandWithLogging("confluent.uploadUDF", uploadUDFCommand);
}
