import * as vscode from "vscode";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import { logError } from "../../errors";
import { EnvironmentId, IEnvProviderRegion } from "../../models/resource";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "../../notifications";
import { flinkCcloudEnvironmentQuickPick } from "../../quickpicks/environments";
import { getSidecar } from "../../sidecar";

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
): Promise<void> {
  const response = await getPresignedUploadUrl(request);
  if (response && response.upload_url) {
    showInfoNotificationWithButtons("Presigned upload URL received.", {
      "Copy URL": () => {
        vscode.env.clipboard.writeText(response.upload_url!);
        vscode.window.showInformationMessage("Upload URL copied to clipboard.");
      },
    });
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
  const fileFormat = await vscode.window.showQuickPick(["zip", "jar"], {
    placeHolder: "Select the file format for the UDF",
  });

  if (!fileFormat) {
    showWarningNotificationWithButtons("Upload UDF cancelled: File format is required.");
    return undefined;
  }

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

  return { environment: environment.id, cloud, region, artifactName, fileFormat };
}
