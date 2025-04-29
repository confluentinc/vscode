import { commands, Disposable, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import {
  currentFlinkArtifactsPoolChanged,
  currentFlinkStatementsResourceChanged,
} from "../emitters";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import {
  flinkComputePoolQuickPick,
  flinkComputePoolQuickPickWithViewProgress,
} from "../quickpicks/flinkComputePools";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../constants";

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

/** Select a {@link FlinkComputePool} to focus in the "Statements" view. */
export async function selectPoolForStatementsViewCommand(item?: CCloudFlinkComputePool) {
  // the user either clicked a pool in the Flink Statements view or used the command palette
  const pool: CCloudFlinkComputePool | undefined =
    item instanceof CCloudFlinkComputePool
      ? item
      : await flinkComputePoolQuickPickWithViewProgress("confluent-flink-statements");
  if (!pool) {
    return;
  }
  currentFlinkStatementsResourceChanged.fire(pool);
  commands.executeCommand("confluent-flink-statements.focus");
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
 * Show a quickpick to select a default {@link FlinkComputePool} and database
 * for Flink SQL operations.
 */
export async function configureFlinkDefaults() {
  const config: Record<string, any> = await workspace.getConfiguration("confluent");
  const flinkConfig = config["flink"] || {};
  // TODO in the near future, let's make this default to the current pool, if any
  const computePool = await flinkComputePoolQuickPick();
  await workspace.getConfiguration().update(FLINK_CONFIG_COMPUTE_POOL, computePool?.id, false);

  // TODO NC db can be switched to filtered quickpick when available
  const database = await window.showInputBox({
    prompt:
      "Name or ID for default CCloud database (Kafka cluster) to use for Flink SQL operations",
    value: flinkConfig["database"],
  });
  await workspace.getConfiguration().update(FLINK_CONFIG_DATABASE, database, false);

  window.showInformationMessage("Flink SQL settings updated.", "View").then((selection) => {
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
