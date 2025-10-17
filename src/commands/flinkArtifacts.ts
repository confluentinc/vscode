import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { DeleteArtifactV1FlinkArtifactRequest } from "../clients/flinkArtifacts/apis/FlinkArtifactsArtifactV1Api";
import {
  CreateArtifactV1FlinkArtifact201Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../clients/flinkArtifacts/models";
import { ContextValues, setContextValue } from "../context/values";
import { artifactsChanged, flinkDatabaseViewMode } from "../emitters";
import { logError } from "../errors";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../notifications";
import { getSidecar } from "../sidecar";
import { logUsage, UserEvent } from "../telemetry/events";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
import { revealArtifact } from "../viewProviders/multiViewDelegates/flinkArtifactsDelegate";
import { artifactUploadQuickPickForm } from "./utils/artifactUploadForm";
import { detectClassesAndRegisterUDFs } from "./utils/udfRegistration";
import {
  buildUploadErrorMessage,
  getPresignedUploadUrl,
  handleUploadToCloudProvider,
  uploadArtifactToCCloud,
} from "./utils/uploadArtifactOrUDF";

/**
 * Orchestrates the sub-functions to complete the artifact upload process.
 * Logs error and shows a user notification if sub-functions fail.
 * Steps are:
 * 1. Gathering request parameters from the user or a provided item.
 * 2. Requesting a presigned URL from Confluent Cloud via Sidecar.
 * 3. Uploading the artifact to the presigned URL (supports AWS or Azure).
 * 4. Displaying progress while creating the Artifact in Confluent Cloud.
 *
 * @param item Optional. If command is invoked from a Flink Compute Pool, CCloud Kafka Cluster, or `.jar` file we use that to pre-fill upload options.
 * If not provided, the user will be prompted for all necessary information.
 */

export async function uploadArtifactCommand(
  item?: CCloudFlinkComputePool | CCloudKafkaCluster | vscode.Uri,
): Promise<void> {
  // 1. Gather the request parameters from user or item (before showing progress)
  const params = await artifactUploadQuickPickForm(item);
  if (!params) return; // User cancelled the prompt

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating artifact`,
        cancellable: false,
      },
      async (progress) => {
        const response = await executeArtifactUpload(params, progress);
        const viewArtifactsButton = "View Artifacts";
        if (response) {
          logUsage(UserEvent.FlinkArtifactAction, {
            action: "upload",
            status: "succeeded",
            kind: "CloudProviderUpload",
            cloud: params.cloud,
            region: params.region,
          });
          void showInfoNotificationWithButtons(
            `Artifact "${response.display_name}" uploaded successfully to Confluent Cloud.`,
            {
              "Register UDFs": async () => {
                await detectClassesAndRegisterUDFs({ selectedFile: params.selectedFile });
              },
              [viewArtifactsButton]: async () => {
                await revealArtifact();
              },
            },
          );
        }
      },
    );
  } catch (err) {
    logUsage(UserEvent.FlinkArtifactAction, {
      action: "upload",
      status: "failed",
      kind: "CloudProviderUpload",
      cloud: params.cloud,
      region: params.region,
    });
    const errorMessage = await buildUploadErrorMessage(err, "Failed to upload artifact:");
    logError(err, errorMessage);
    void showErrorNotificationWithButtons(errorMessage);
  }
}

/**
 * Performs the multi-step artifact upload, reporting progress along the way.
 * Throws on failure so the caller (upload command) can handle error telemetry + notification.
 */
async function executeArtifactUpload(
  params: Awaited<ReturnType<typeof artifactUploadQuickPickForm>>,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<CreateArtifactV1FlinkArtifact201Response | undefined> {
  if (!params) return;

  logUsage(UserEvent.FlinkArtifactAction, {
    action: "upload",
    status: "started",
    kind: "CloudProviderUpload",
    cloud: params.cloud,
    region: params.region,
  });

  const stepPortion = 100 / 3; // 3 internal steps

  // Step 1: Request presigned URL
  progress.report({ message: "Requesting presigned upload URL...", increment: stepPortion });
  const request: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
    environment: params.environment,
    cloud: params.cloud,
    region: params.region,
    id: params.artifactName,
    content_format: params.fileFormat,
  };
  const uploadUrl = await getPresignedUploadUrl(request);
  if (!uploadUrl) {
    throw new Error("Upload ID is missing from the presigned URL response.");
  }

  // Step 2: Upload binary to cloud storage (AWS/Azure)
  progress.report({
    message: "Uploading artifact binary to cloud storage...",
    increment: stepPortion,
  });
  await handleUploadToCloudProvider(params, uploadUrl);

  // Step 3: Create artifact in Confluent Cloud
  progress.report({
    message: "Adding artifact to Confluent Cloud...",
    increment: stepPortion,
  });
  const response = await uploadArtifactToCCloud(params, uploadUrl.upload_id!);
  return response;
}

export async function deleteArtifactCommand(
  selectedArtifact: FlinkArtifact | undefined,
): Promise<void> {
  if (!selectedArtifact) {
    void showErrorNotificationWithButtons("No Flink artifact selected for deletion.");
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

  artifactsChanged.fire(selectedArtifact);

  void vscode.window.showInformationMessage(
    `Artifact "${selectedArtifact.name}" deleted successfully from Confluent Cloud.`,
  );
}

/** Set the Flink Database view to Artifacts mode */
export async function setFlinkArtifactsViewModeCommand() {
  flinkDatabaseViewMode.fire(FlinkDatabaseViewProviderMode.Artifacts);
  await setContextValue(
    ContextValues.flinkDatabaseViewMode,
    FlinkDatabaseViewProviderMode.Artifacts,
  );
}

/**
 * Registers the Flink Artifact commands with logging.
 */
export function registerFlinkArtifactCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.uploadArtifact", uploadArtifactCommand),
    registerCommandWithLogging("confluent.deleteArtifact", deleteArtifactCommand),
    registerCommandWithLogging(
      "confluent.flinkdatabase.setArtifactsViewMode",
      setFlinkArtifactsViewModeCommand,
    ),
  ];
}
