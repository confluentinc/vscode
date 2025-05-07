import { commands, Disposable, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { currentFlinkArtifactsPoolChanged } from "../emitters";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { updateDefaultFlinkDatabaseId, updateDefaultFlinkPoolId } from "../preferences/updates";
import {
  flinkComputePoolQuickPick,
  flinkComputePoolQuickPickWithViewProgress,
} from "../quickpicks/flinkComputePools";
import { flinkDatabaseQuickpick } from "../quickpicks/kafkaClusters";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";

const logger = new Logger("commands.flinkComputePools");

/**
 * Select a {@link FlinkComputePool} from the "Resources" view to focus both the "Statements" and
 * "Artifacts" views.
 *
 * This is the same as selecting the same pool for both the
 * `confluent.statements.flink-compute-pool.select` and
 * `confluent.artifacts.flink-compute-pool.select` commands.
 */
export async function selectPoolFromResourcesViewCommand(item?: CCloudFlinkComputePool) {
  // the user either clicked a pool in the Resources view or used the command palette
  const pool: CCloudFlinkComputePool | undefined =
    item instanceof CCloudFlinkComputePool
      ? item
      : await flinkComputePoolQuickPickWithViewProgress("confluent-resources");
  if (!pool) {
    return;
  }

  // TODO: check if views are visible and pass an arg in here to prevent `focus` if not
  await Promise.all([
    selectPoolForArtifactsViewCommand(pool),
    selectPoolForStatementsViewCommand(pool),
  ]);
}

/**
 * Select a {@link FlinkComputePool} to focus in the "Statements" view.
 */
export async function selectPoolForStatementsViewCommand(item?: CCloudFlinkComputePool) {
  // the user either clicked a pool in the Flink Statements view or used the command palette
  const pool: CCloudFlinkComputePool | undefined =
    item instanceof CCloudFlinkComputePool
      ? item
      : await flinkComputePoolQuickPickWithViewProgress("confluent-flink-statements");

  if (!pool) {
    // user canceled the quickpick
    return;
  }

  // Focus the Flink Statements view to make sure it is visible.
  commands.executeCommand("confluent-flink-statements.focus");

  // Inform the Flink Statements view that the user has selected a new compute pool, and wait
  // for the view to repaint itself with the new pool's statements.
  const flinkStatementsView = FlinkStatementsViewProvider.getInstance();
  await flinkStatementsView.setParentResource(pool);
}

/** Select a {@link FlinkComputePool} to focus in the "Artifacts" view. */
export async function selectPoolForArtifactsViewCommand(item?: CCloudFlinkComputePool) {
  // the user either clicked a pool in the Flink Artifacts view or used the command palette
  const pool: CCloudFlinkComputePool | undefined =
    item instanceof CCloudFlinkComputePool
      ? item
      : await flinkComputePoolQuickPickWithViewProgress("confluent-flink-artifacts");
  if (!pool) {
    return;
  }
  currentFlinkArtifactsPoolChanged.fire(pool);
  commands.executeCommand("confluent-flink-artifacts.focus");
}

/**
 * Show a quickpick to select a default setting for {@link FlinkComputePool} and database
 * for Flink SQL operations.
 */
export async function configureFlinkDefaults() {
  const computePool = await flinkComputePoolQuickPick();
  if (!computePool) {
    logger.debug("No compute pool selected & none found in configuration, skipping flink config");
    return;
  }
  await updateDefaultFlinkPoolId(computePool);

  const databaseCluster: KafkaCluster | undefined = await flinkDatabaseQuickpick(computePool);
  if (!databaseCluster) {
    logger.debug("User canceled the default database quickpick");
    return;
  }
  // Note: we can use name or ID for Language Server, but name used in Cloud UI since what you send is what shows in completions documentation
  await updateDefaultFlinkDatabaseId(databaseCluster as CCloudKafkaCluster);

  window.showInformationMessage("Flink SQL defaults updated.", "View").then((selection) => {
    if (selection === "View") {
      commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:confluentinc.vscode-confluent flink",
      );
    }
  });
}

export function registerFlinkComputePoolCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.resources.flink-compute-pool.select",
      selectPoolFromResourcesViewCommand,
    ),
    registerCommandWithLogging(
      "confluent.statements.flink-compute-pool.select",
      selectPoolForStatementsViewCommand,
    ),
    registerCommandWithLogging(
      "confluent.artifacts.flink-compute-pool.select",
      selectPoolForArtifactsViewCommand,
    ),
    registerCommandWithLogging("confluent.flink.configureFlinkDefaults", configureFlinkDefaults),
  ];
}
