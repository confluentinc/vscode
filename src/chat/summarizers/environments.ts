import { MarkdownString } from "vscode";
import { Environment } from "../../models/environment";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { CCloudKafkaCluster } from "../../models/kafkaCluster";
import { isCCloud } from "../../models/resource";
import { CCloudSchemaRegistry } from "../../models/schemaRegistry";

export function summarizeEnvironment(env: Environment): string {
  const summary = new MarkdownString()
    .appendMarkdown(`### "${env.name}"`)
    .appendMarkdown(`\n- ID: ${env.id}`);

  const isCCloudEnv: boolean = isCCloud(env);

  // only include names and IDs of child resources, for easier follow-up tool calls
  if (env.kafkaClusters.length) {
    summary.appendMarkdown(`\n- Kafka Clusters:`);
    env.kafkaClusters.forEach((cluster) => {
      summary.appendMarkdown(`\n  - "${cluster.name}" (ID: ${cluster.id})`);
      if (isCCloudEnv) {
        const ccloudCluster = cluster as CCloudKafkaCluster;
        summary.appendMarkdown(
          `\n    - Cloud Provider & Region: ${ccloudCluster.provider} ${ccloudCluster.region}`,
        );
      }
    });
  }
  if (env.schemaRegistry) {
    summary.appendMarkdown(`\n- Schema Registry:`);
    summary.appendMarkdown(`\n  - "${env.schemaRegistry.name}" (ID: ${env.schemaRegistry.id})`);
    if (isCCloudEnv) {
      const ccloudSR = env.schemaRegistry as CCloudSchemaRegistry;
      summary.appendMarkdown(
        `\n    - Cloud Provider & Region: ${ccloudSR.provider} ${ccloudSR.region}`,
      );
    }
  }
  if (env.flinkComputePools.length) {
    summary.appendMarkdown(`\n- Flink Compute Pools:`);
    env.flinkComputePools.forEach((pool) => {
      summary.appendMarkdown(`\n  - "${pool.name}" (ID: ${pool.id})`);
      if (isCCloudEnv) {
        const ccloudPool = pool as CCloudFlinkComputePool;
        summary.appendMarkdown(
          `\n    - Cloud Provider & Region: ${ccloudPool.provider} ${ccloudPool.region}`,
        );
      }
    });
  }

  return summary.value;
}
