import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import {
  GetArtifactV1FlinkArtifact200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../clients/flinkArtifacts/models";
import { logError } from "../errors";
import { showErrorNotificationWithButtons } from "../notifications";
import {
  getPresignedUploadUrl,
  handleUploadToCloudProvider,
  promptForUDFUploadParams,
  uploadArtifactToCCloud,
} from "./utils/uploadUDF";
/**
 * Prompts the user for environment, cloud provider, region, and artifact name.
 * Returns an object with these values, or undefined if the user cancels.
 */

export async function uploadUDFCommand(): Promise<
  GetArtifactV1FlinkArtifact200Response | undefined
> {
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
        void vscode.window.showInformationMessage(
          `Artifact "${response.display_name}" uploaded successfully to Confluent Cloud.`,
        );
      },
    );
  } catch (err) {
    logError(err, "Failed to execute Upload UDF command");
    void showErrorNotificationWithButtons(
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
