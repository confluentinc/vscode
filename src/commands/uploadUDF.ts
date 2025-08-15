import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts/models";
import { logError } from "../errors";
import { showErrorNotificationWithButtons } from "../notifications";
import {
  getPresignedUploadUrl,
  handleUploadFile,
  promptForUDFUploadParams,
} from "./utils/uploadUDF";
/**
 * Prompts the user for environment, cloud provider, region, and artifact name.
 * Returns an object with these values, or undefined if the user cancels.
 */

export async function uploadUDFCommand(): Promise<void> {
  try {
    const params = await promptForUDFUploadParams();

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
/**
 * Registers the "confluent.uploadUDF" command with logging.
 */
export function registerUploadUDFCommand(): vscode.Disposable {
  return registerCommandWithLogging("confluent.uploadUDF", uploadUDFCommand);
}
