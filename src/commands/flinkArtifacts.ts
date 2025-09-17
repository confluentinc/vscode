import * as vscode from "vscode";
import { SnippetString, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { DeleteArtifactV1FlinkArtifactRequest } from "../clients/flinkArtifacts/apis/FlinkArtifactsArtifactV1Api";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts/models";
import { ContextValues, setContextValue } from "../context/values";
import { artifactUploadDeleted, flinkDatabaseViewMode } from "../emitters";
import { extractResponseBody, isResponseError, logError } from "../errors";
import { CCloudResourceLoader } from "../loaders";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudFlinkDbKafkaCluster, CCloudKafkaCluster } from "../models/kafkaCluster";
import {
  showErrorNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "../notifications";
import { getSidecar } from "../sidecar";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
import {
  getPresignedUploadUrl,
  handleUploadToCloudProvider,
  promptForArtifactUploadParams,
  uploadArtifactToCCloud,
} from "./utils/uploadArtifact";

/**
 * Orchestrates the sub-functions from uploadArtifact.ts to complete the artifact upload process.
 * Logs error and shows a user notification if sub-functions fail.
 * Steps are:
 * 1. Gathering request parameters from the user or a provided item.
 * 2. Requesting a presigned URL from Confluent Cloud via Sidecar.
 * 3. Uploading the artifact to the presigned URL (supports AWS or Azure).
 * 4. Displaying progress while creating the Artifact in Confluent Cloud.
 *
 * @param item Optional. If command is invoked from a Flink Compute Pool, CCloud Kafka Cluster, or `.jar` file we use that to pre-fill upload options.
 * If not provided, the user will be prompted for all necessary information.
 * In the near future this will become a webview form with more inputs. See: https://github.com/confluentinc/vscode/issues/2539
 */

export async function uploadArtifactCommand(
  item?: CCloudFlinkComputePool | CCloudKafkaCluster | vscode.Uri,
): Promise<void> {
  try {
    // 1. Gather the request parameters from user or item
    const params = await promptForArtifactUploadParams(item);
    if (!params) return; // User cancelled the prompt

    const request: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
      environment: params.environment,
      cloud: params.cloud,
      region: params.region,
      id: params.artifactName,
      content_format: params.fileFormat,
    };

    // 2. Get presigned URL from Confluent Cloud via Sidecar
    const uploadUrl = await getPresignedUploadUrl(request);

    if (!uploadUrl) {
      throw new Error("Upload ID is missing from the presigned URL response.");
    }

    // 3. Upload the artifact to the presigned URL (either AWS or Azure)
    await handleUploadToCloudProvider(params, uploadUrl);

    // 4/Last. Show our progress while creating the Artifact in Confluent Cloud (TODO should this wrap all the steps?)
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
    let errorMessage = "Failed to upload artifact: ";
    if (isResponseError(err)) {
      const resp = await extractResponseBody(err);
      try {
        errorMessage = `${errorMessage} ${resp?.errors?.[0]?.detail}`;
      } catch {
        errorMessage = `${errorMessage} ${typeof resp === "string" ? resp : JSON.stringify(resp)}`;
      }
    } else if (err instanceof Error) {
      errorMessage = `${errorMessage} ${err.message}`;
    }
    logError(err, errorMessage);
    showErrorNotificationWithButtons(errorMessage);
  }
}

export async function deleteArtifactCommand(
  selectedArtifact: FlinkArtifact | undefined,
): Promise<void> {
  if (!selectedArtifact) {
    showErrorNotificationWithButtons("No Flink artifact selected for deletion.");
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

export async function fakeCommandForFlinkCreation(selectedArtifact: FlinkArtifact | undefined) {
  if (!selectedArtifact) {
    return;
  }

  try {
    const ccloudResourceLoader = CCloudResourceLoader.getInstance();
    const flinkDatabaseProvider = FlinkDatabaseViewProvider.getInstance();
    const selectedResource = flinkDatabaseProvider.resource;

    // Get environment data
    const environments = await ccloudResourceLoader.getEnvironments();
    const environment = environments.find((env) => env.id === selectedArtifact.environmentId);

    if (!environment) {
      throw new Error(`Environment ${selectedArtifact.environmentId} not found`);
    }

    // Find Flink-capable databases
    // either fix in here or add ticket for util to filter out non-Flink clusters from environment API
    const flinkDatabases = environment.kafkaClusters.filter((cluster) => cluster.isFlinkable());
    if (flinkDatabases.length === 0) {
      throw new Error(
        `No Flink-capable databases found in environment ${selectedArtifact.environmentId}`,
      );
    }

    // Determine database and compute pool to use
    let database: CCloudFlinkDbKafkaCluster | undefined;
    let computePool: CCloudFlinkComputePool | undefined;

    // First try to use the selected resource from view if available
    //sketchy
    if (selectedResource) {
      if (selectedResource.isFlinkable?.()) {
        // Resource is a Flink-capable database
        database = selectedResource as CCloudFlinkDbKafkaCluster;
        computePool = database.flinkPools[0];
      } else if (selectedResource instanceof CCloudFlinkComputePool) {
        // Resource is a compute pool, find compatible database
        computePool = selectedResource;
        database = flinkDatabases.find(
          (db) =>
            db.provider === computePool?.provider &&
            db.region === computePool?.region &&
            db.flinkPools?.some((pool) => pool.id === computePool?.id),
        ) as CCloudFlinkDbKafkaCluster;
      }
    }

    // Create UDF with progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Creating UDF function from artifact",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Executing statement..." });
        //TODO LATER DEV HACK REMOVE MATH RANDOM FUNC
        const functionName = `udf_${selectedArtifact.id.substring(0, 6)}_${Math.random().toString(16).slice(2, 8)}`;
        // TODO show input box and allow name change
        const result = await ccloudResourceLoader.executeFlinkStatement<string>(
          `CREATE FUNCTION \`${functionName}\` AS 'io.confluent.udf.examples.log.LogSumScalarFunction' USING JAR 'confluent-artifact://${selectedArtifact.id}';`,
          database!,
          computePool!,
        );

        progress.report({ message: "Processing results..." });
        if (result.length === 0) {
          void showWarningNotificationWithButtons(
            "Function created successfully, but no response was returned from Confluent Cloud.",
          );
          return;
        }
      },
    );
  } catch (err) {
    // Handle errors not already shown as notifications
    // todo: make sure errors clean as possible
    if (!(err instanceof Error && err.message.includes("Failed to create UDF function"))) {
      let errorMessage = "Failed to create UDF function: ";

      if (isResponseError(err)) {
        const resp = await extractResponseBody(err);
        try {
          errorMessage = `${errorMessage} ${resp?.errors?.[0]?.detail}`;
        } catch {
          errorMessage = `${errorMessage} ${typeof resp === "string" ? resp : JSON.stringify(resp)}`;
        }
      } else if (err instanceof Error) {
        errorMessage = `${errorMessage} ${err.message}`;

        logError(err, errorMessage);
        showErrorNotificationWithButtons(errorMessage);
      }
    }
  }
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
    registerCommandWithLogging("confluent.artifacts.registerUDF", queryArtifactWithFlink),
    registerCommandWithLogging("confluent.artifacts.stubCreation", fakeCommandForFlinkCreation),
  ];
}
