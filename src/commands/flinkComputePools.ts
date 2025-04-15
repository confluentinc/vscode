import { commands, Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import {
  currentFlinkArtifactsPoolChanged,
  currentFlinkStatementsResourceChanged,
} from "../emitters";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { flinkComputePoolQuickPickWithViewProgress } from "../quickpicks/flinkComputePools";

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
  ];
}
