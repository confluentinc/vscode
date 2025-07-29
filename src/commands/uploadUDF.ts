import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../clients/flinkArtifacts";
import { logError } from "../errors";
import { EnvironmentId, IEnvProviderRegion } from "../models/resource";
import { getSidecar } from "../sidecar";

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

export async function uploadUDFCommand(): Promise<void> {
  try {
    // Prompt for environment, cloud provider, and region
    const environment = await vscode.window.showInputBox({
      prompt: "Enter the Environment ID for the UDF upload",
      ignoreFocusOut: true,
      validateInput: (value) => (value ? undefined : "Environment ID is required"),
    });
    if (!environment) {
      vscode.window.showWarningMessage("Upload UDF cancelled: Environment ID is required.");
      return;
    }

    const cloud = await vscode.window.showQuickPick(["AWS", "Azure"], {
      placeHolder: "Select the cloud provider for the UDF upload",
    });
    if (!cloud) {
      vscode.window.showWarningMessage("Upload UDF cancelled: Cloud provider is required.");
      return;
    }

    const region = await vscode.window.showInputBox({
      prompt: "Enter the region for the UDF upload",
      ignoreFocusOut: true,
      validateInput: (value) => (value ? undefined : "Region is required"),
    });
    if (!region) {
      vscode.window.showWarningMessage("Upload UDF cancelled: Region is required.");
      return;
    }

    // Prompt for artifact name
    const artifactName = await vscode.window.showInputBox({
      prompt: "Enter the artifact name for the UDF",
      ignoreFocusOut: true,
      validateInput: (value) => (value ? undefined : "Artifact name is required"),
    });
    if (!artifactName) {
      vscode.window.showWarningMessage("Upload UDF cancelled: Artifact name is required.");
      return;
    }

    // Build the request object
    const request: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      environment,
      cloud,
      region,
      id: artifactName,
      content_format: "zip", // or another valid format as required by your API
    };

    // Call the API
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Requesting presigned upload URL...",
        cancellable: false,
      },
      async () => {
        const response = await getPresignedUploadUrl(request);
        if (response && response.upload_url) {
          vscode.window
            .showInformationMessage("Presigned upload URL received.", "Copy URL")
            .then((selection) => {
              if (selection === "Copy URL") {
                void vscode.env.clipboard.writeText(response.upload_url!);
                vscode.window.showInformationMessage("Upload URL copied to clipboard.");
              }
            });
        } else {
          vscode.window.showErrorMessage(
            "Failed to get presigned upload URL. See logs for details.",
          );
        }
      },
    );
  } catch (err) {
    logError(err, "Failed to execute Upload UDF command");
    vscode.window.showErrorMessage("An error occurred while uploading UDF. See logs for details.");
  }
}
/**
 * Registers the "confluent.uploadUDF" command with logging.
 */
export function registerUploadUDFCommand(): vscode.Disposable {
  return registerCommandWithLogging("confluent.uploadUDF", uploadUDFCommand);
}
