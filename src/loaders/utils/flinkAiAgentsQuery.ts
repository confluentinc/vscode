/** CCLoudResourceLoader Flink statement utils for AI Agents */
import { FlinkAIAgent } from "../../models/flinkAiAgent";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

/**
 * Generate the query to list all available Flink AI agents for a given Flink catalog+database.
 * @see https://docs.confluent.io/cloud/current/flink/reference/statements/show.html#flink-sql-show-agents
 */
export function getFlinkAIAgentsQuery(database: CCloudFlinkDbKafkaCluster): string {
  return `SHOW AGENTS FROM \`${database.environmentId}\`.\`${database.id}\``;
}

/** Raw results type corresponding to `SHOW AGENTS` query */
export type RawFlinkAIAgentRow = {
  "Agent Name": string;
};

/**
 * Transform raw agent rows from the `SHOW AGENTS` query into basic {@link FlinkAIAgent} objects.
 *
 * @param database What cluster these agents belong to
 * @param rawResults The raw rows from the `SHOW AGENTS` query
 * @returns Array of {@link FlinkAIAgent} objects, sorted by name.
 */
export function transformRawFlinkAIAgentRows(
  database: CCloudFlinkDbKafkaCluster,
  rawResults: RawFlinkAIAgentRow[],
): FlinkAIAgent[] {
  const agents: FlinkAIAgent[] = rawResults.map((row) => {
    return new FlinkAIAgent({
      environmentId: database.environmentId,
      provider: database.provider,
      region: database.region,
      databaseId: database.id,
      name: row["Agent Name"],
    });
  });

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}
