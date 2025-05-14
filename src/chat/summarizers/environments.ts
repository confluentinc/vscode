import { MarkdownString } from "vscode";
import { Environment } from "../../models/environment";

export function summarizeEnvironment(env: Environment): string {
  const summary = new MarkdownString()
    .appendMarkdown(`### "${env.name}"`)
    .appendMarkdown(`\n- ID: ${env.id}`);

  // only include names and IDs of child resources, for easier follow-up tool calls
  if (env.kafkaClusters.length) {
    summary.appendMarkdown(`\n- Kafka Clusters:`);
    env.kafkaClusters.forEach((cluster) => {
      summary.appendMarkdown(`\n  - "${cluster.name}" (ID: ${cluster.id})`);
    });
  }
  if (env.schemaRegistry) {
    summary.appendMarkdown(`\n- Schema Registry:`);
    summary.appendMarkdown(`\n  - "${env.schemaRegistry.name}" (ID: ${env.schemaRegistry.id})`);
  }
  if (env.flinkComputePools.length) {
    summary.appendMarkdown(`\n- Flink Compute Pools:`);
    env.flinkComputePools.forEach((pool) => {
      summary.appendMarkdown(`\n  - "${pool.name}" (ID: ${pool.id})`);
    });
  }

  return summary.value;
}
