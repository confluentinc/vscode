import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts/models";
import { isResponseError, logError } from "../errors";
import {
  showErrorNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "../notifications";
import {
  getPresignedUploadUrl,
  handleUploadToCloudProvider,
  promptForArtifactUploadParams,
  uploadArtifactToCCloud,
} from "./utils/uploadArtifact";
/**
 * Prompts the user for environment, cloud provider, region, and artifact name.
 * Returns an object with these values, or undefined if the user cancels.
 */

export async function uploadArtifactCommand(): Promise<void> {
  try {
    const params = await promptForArtifactUploadParams();

    if (!params) {
      // User cancelled the prompt
      return;
    }

    const request: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      environment: params.environment,
      cloud: params.cloud,
      region: params.region,
      id: params.artifactName,
      content_format: params.fileFormat,
    };

    const uploadUrl = await getPresignedUploadUrl(request);

    await handleUploadToCloudProvider(params, uploadUrl);

    if (!uploadUrl.upload_id) {
      throw new Error("Upload ID is missing from the presigned URL response.");
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Uploading artifact "${params.artifactName}" to Confluent Cloud`,
        cancellable: false,
      },
      async () => {
        const response = await uploadArtifactToCCloud(params, uploadUrl.upload_id!);
        if (response) {
          void vscode.window.showInformationMessage(
            `Artifact "${response.display_name}" uploaded successfully to Confluent Cloud.`,
          );
        } else {
          void showWarningNotificationWithButtons(
            `Artifact upload completed, but no response was returned from Confluent Cloud.`,
          );
        }
      },
    );
  } catch (err) {
    let logErrMessage: string;
    let showNotificationMessage: string;
    if (isResponseError(err)) {
      try {
        const respJson = await err.response.clone().json();
        logErrMessage = `Status: ${err.response.status}, Response: ${JSON.stringify(respJson)}`;
        showNotificationMessage = `Failed to upload artifact: ${err.message}. See logs for details.`;
        if (respJson && typeof respJson === "object") {
          logErrMessage = JSON.stringify(respJson);
          showNotificationMessage =
            respJson.error?.message ||
            respJson.message ||
            `Failed to upload artifact: ${err.message}. See logs for details.`;
        }
      } catch {
        logErrMessage = await err.response.clone().text();
        showNotificationMessage = `Failed to upload artifact: ${err.message}. See logs for details.`;
      }
    } else {
      logErrMessage = `Failed to upload artifact: ${err}`;
      showNotificationMessage = "Failed to upload artifact. See logs for details.";
    }
    logError(logErrMessage, "Failed to upload artifact");
    showErrorNotificationWithButtons(showNotificationMessage);
  }
}
/**
 * Registers the "confluent.uploadArtifact" command with logging.
 */
export function registerUploadArtifactCommand(): vscode.Disposable {
  return registerCommandWithLogging("confluent.uploadArtifact", uploadArtifactCommand);
}
