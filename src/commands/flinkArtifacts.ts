import * as vscode from "vscode";
import { SnippetString, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { DeleteArtifactV1FlinkArtifactRequest } from "../clients/flinkArtifacts/apis/FlinkArtifactsArtifactV1Api";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts/models";
import { ContextValues, setContextValue } from "../context/values";
import { artifactUploadDeleted, flinkArtifactUDFViewMode } from "../emitters";
import { isResponseError, logError } from "../errors";
import { FlinkArtifact } from "../models/flinkArtifact";
import {
  showErrorNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "../notifications";
import { getSidecar } from "../sidecar";
import { FlinkArtifactsViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
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

export async function deleteArtifactCommand(
  selectedArtifact: FlinkArtifact | undefined,
): Promise<void> {
  if (!selectedArtifact) {
    void vscode.window.showErrorMessage(
      "Cannot delete artifact: missing required artifact properties.",
    );
    return;
  }
  const request: DeleteArtifactV1FlinkArtifactRequest = {
    cloud: selectedArtifact.provider,
    region: selectedArtifact.region,
    environment: selectedArtifact.environmentId,
    id: selectedArtifact.id,
  };
  const sidecarHandle = await getSidecar();

  const artifactsClient = sidecarHandle.getFlinkArtifactsApi({
    region: selectedArtifact.region,
    environmentId: selectedArtifact.environmentId,
    provider: selectedArtifact.provider,
  });

  const yesButton = "Yes, delete";
  const confirmation = await vscode.window.showWarningMessage(
    `Are you sure you want to delete "${selectedArtifact.name}"?`,
    {
      modal: true,
      detail:
        "Deleting this artifact will disable all User-Defined Functions (UDFs) created from it. Consequently, any Flink statements that utilize these UDFs will also fail. This action cannot be undone.",
    },
    { title: yesButton },
    // "Cancel" is added by default
  );
  if (confirmation?.title !== yesButton) {
    return;
  }

  await artifactsClient.deleteArtifactV1FlinkArtifact(request);
  artifactUploadDeleted.fire();
  void vscode.window.showInformationMessage(
    `Artifact "${selectedArtifact.name}" deleted successfully from Confluent Cloud.`,
  );
}

export async function queryArtifactWithFlink(selectedArtifact: FlinkArtifact | undefined) {
  if (!selectedArtifact) {
    return;
  }
  const snippetString = new SnippetString()
    .appendText(`-- Register UDF for artifact "${selectedArtifact.name}"\n`)
    .appendText("CREATE FUNCTION `")
    .appendPlaceholder("yourFunctionNameHere", 1)
    .appendText("` AS '")
    .appendPlaceholder("your.class.NameHere", 2)
    .appendText(`' USING JAR 'confluent-artifact://${selectedArtifact.id}';\n`)
    .appendText("-- confirm with 'SHOW USER FUNCTIONS';\n");

  const document = await workspace.openTextDocument({
    language: "flinksql",
    // content is initialized as an empty string, we insert the snippet next due to how the Snippets API works
    content: "",
  });

  const editor = await window.showTextDocument(document, { preview: false });
  await editor.insertSnippet(snippetString);
}

export async function setFlinkArtifactsViewModeCommand() {
  flinkArtifactUDFViewMode.fire(FlinkArtifactsViewProviderMode.Artifacts);
  await setContextValue(
    ContextValues.flinkArtifactsUDFsViewMode,
    FlinkArtifactsViewProviderMode.Artifacts,
  );
}

/**
 * Registers the Flink Artifact commands with logging.
 */
export function registerFlinkArtifactCommand(): vscode.Disposable[] {
  // Register only the upload command here
  return [
    registerCommandWithLogging("confluent.uploadArtifact", uploadArtifactCommand),
    registerCommandWithLogging("confluent.deleteArtifact", deleteArtifactCommand),
    registerCommandWithLogging(
      "confluent.flink.setArtifactsViewMode",
      setFlinkArtifactsViewModeCommand,
    ),
    registerCommandWithLogging("confluent.artifacts.registerUDF", queryArtifactWithFlink),
  ];
}
