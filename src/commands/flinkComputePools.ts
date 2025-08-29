import { commands, Disposable, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { KafkaCluster } from "../models/kafkaCluster";
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

  // need to pass a new argument to prevent the views from being focused,
  // see https://github.com/confluentinc/vscode/issues/1967

  // Indirectly invoke selectPoolForStatementsViewCommand() and perhaps
  // selectPoolForArtifactsViewCommand() to update the views with the selected pool.
  // (The indirection is done for test mocking purposes -- cannot stub
  // functions within the same module, but can always stub commands.executeCommand().)

  const thenables: Thenable<void>[] = [
    // Will invoke selectPoolForStatementsViewCommand().
    commands.executeCommand("confluent.statements.flink-compute-pool.select", pool),
  ];

  await Promise.all(thenables);
}

/**
 * Select a {@link FlinkComputePool} to focus in the "Statements" view.
 */
export async function selectPoolForStatementsViewCommand(pool?: CCloudFlinkComputePool) {
  // the user either clicked a pool in the Flink Statements view or used the command palette

  // (If the user had a Flink Statement selected in the statements view, then hits the
  //  icon to select a different pool, the command is invoked with *the FlinkStatement*,
  //  so be sure to treat that the same as if nothing provided at all, and to ask the
  //  user to pick a new pool.)
  if (!pool || !(pool instanceof CCloudFlinkComputePool)) {
    pool = await flinkComputePoolQuickPickWithViewProgress(
      "confluent-flink-statements",
      // Initially select whatever the view is currently set to. Will be null if not focused on exactly one pool.
      FlinkStatementsViewProvider.getInstance().computePool,
    );
  }

  if (!pool) {
    // none provided by caller and then user canceled the quickpick
    return;
  }

  // Focus the Flink Statements view to make sure it is visible.
  commands.executeCommand("confluent-flink-statements.focus");

  // Inform the Flink Statements view that the user has selected a new compute pool, and wait
  // for the view to load the new pool's statements.
  const flinkStatementsView = FlinkStatementsViewProvider.getInstance();
  await flinkStatementsView.setParentResource(pool);
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
  await FLINK_CONFIG_COMPUTE_POOL.update(computePool.id, true);

  const databaseCluster: KafkaCluster | undefined = await flinkDatabaseQuickpick(computePool);
  if (!databaseCluster) {
    logger.debug("User canceled the default database quickpick");
    return;
  }
  // Note: we can use name or ID for Language Server, but name used in Cloud UI since what you send is what shows in completions documentation
  await FLINK_CONFIG_DATABASE.update(databaseCluster.id, true);

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
    registerCommandWithLogging("confluent.flink.configureFlinkDefaults", configureFlinkDefaults),
  ];
}
