import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts/models";
import { logError } from "../errors";
import { showErrorNotificationWithButtons } from "../notifications";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
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
 * Note: this is a placeholder, the final command will register and upload the UDF in a clean sweep.
 */
export function registerUploadUDFCommand(): vscode.Disposable {
  return registerCommandWithLogging("confluent.uploadUDF", uploadUDFCommand);
}
