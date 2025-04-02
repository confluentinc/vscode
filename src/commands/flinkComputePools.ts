import { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { FlinkComputePool } from "../models/flinkComputePool";

/**
 * Select a {@link FlinkComputePool} from the "Resources" view to focus both the "Statements" and
 * "Artifacts" views.
 *
 * This is the same as selecting the same pool for both the
 * `confluent.statements.flink-compute-pool.select` and
 * `confluent.artifacts.flink-compute-pool.select` commands.
 */
export function selectPoolFromResourcesViewCommand(pool?: FlinkComputePool) {
  if (!(pool instanceof FlinkComputePool)) {
    return;
  }
}

/** Select a {@link FlinkComputePool} to focus in the "Statements" view. */
export function selectPoolForStatementsViewCommand(pool?: FlinkComputePool) {
  if (!(pool instanceof FlinkComputePool)) {
    return;
  }
}

/** Select a {@link FlinkComputePool} to focus in the "Artifacts" view. */
export function selectPoolForArtifactsViewCommand(pool?: FlinkComputePool) {
  if (!(pool instanceof FlinkComputePool)) {
    return;
  }
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
