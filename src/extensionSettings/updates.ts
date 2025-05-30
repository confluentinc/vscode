import { workspace } from "vscode";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "./constants";

export async function updateDefaultFlinkPoolId(pool: CCloudFlinkComputePool) {
  const config = workspace.getConfiguration();
  await config.update(FLINK_CONFIG_COMPUTE_POOL, pool.id, true);
}

export async function updateDefaultFlinkDatabaseId(database: CCloudKafkaCluster) {
  const config = workspace.getConfiguration();
  await config.update(FLINK_CONFIG_DATABASE, database.id, true);
}
