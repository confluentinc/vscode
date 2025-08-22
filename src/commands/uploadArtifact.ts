import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts/models";
import { isResponseError, logError } from "../errors";
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
          void vscode.window.showWarningMessage(
            `Artifact upload completed, but no response was returned from Confluent Cloud.`,
          );
        }
      },
    );
  } catch (err) {
    if (isResponseError(err)) {
      let errBody: string | undefined;
      try {
        const respJson = await err.response.clone().json();
        if (respJson && typeof respJson === "object") {
          errBody = JSON.stringify(respJson);
        }
      } catch {
        errBody = await err.response.clone().text();
      }
      if (errBody) {
        const userMessage = `Failed to upload artifact: ${err.message} - ${errBody}`;
        void vscode.window.showErrorMessage(userMessage);
        logError(userMessage, "Artifact upload failed with response error");
      }
    }
  }
}
/**
 * Registers the "confluent.uploadArtifact" command with logging.
 */
export function registerUploadArtifactCommand(): vscode.Disposable {
  return registerCommandWithLogging("confluent.uploadArtifact", uploadArtifactCommand);
}
