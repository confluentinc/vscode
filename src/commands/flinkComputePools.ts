import { commands, ConfigurationTarget, Disposable, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import {
  currentFlinkArtifactsPoolChanged,
  currentFlinkStatementsResourceChanged,
} from "../emitters";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import {
  flinkComputePoolQuickPickWithViewProgress,
  flinkComputePoolQuickPick,
} from "../quickpicks/flinkComputePools";
import { getFlinkSqlSettings } from "../flinkSql/languageClient";

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
    registerCommandWithLogging("confluent.flink.configureLanguageServer", async () => {
      // POC only: one option is saving workspace-level settings
      const settings = getFlinkSqlSettings();

      const computePool = await flinkComputePoolQuickPick();
      if (computePool === undefined) return;

      const catalog = await window.showInputBox({
        prompt: "Enter Flink SQL catalog name",
        value: settings.catalog,
      });
      if (catalog === undefined) return;

      const database = await window.showInputBox({
        prompt: "Enter Flink SQL database name",
        value: settings.database,
      });
      if (database === undefined) return;

      const config: Record<string, any> = await workspace.getConfiguration();
      const flinkConfig = config["confluent.flink"] || {};
      console.log("Updating Flink SQL settings", flinkConfig);

      flinkConfig.catalog = catalog;
      flinkConfig["database"] = database;
      flinkConfig["computePoolId"] = computePool.id;
      await workspace
        .getConfiguration()
        .update("confluent.flink", flinkConfig, ConfigurationTarget.Workspace);

      window.showInformationMessage("Flink SQL settings updated.");
    }),
  ];
}
