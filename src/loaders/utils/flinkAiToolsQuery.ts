/** CCLoudResourceLoader Flink statement utils for AI Tools */
import { FlinkAITool } from "../../models/flinkAiTool";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

/**
 * Generate the query to list all available Flink AI tools for a given Flink catalog+database.
 * @see https://docs.confluent.io/cloud/current/flink/reference/statements/show.html#flink-sql-show-tools
 */
export function getFlinkAIToolsQuery(database: CCloudFlinkDbKafkaCluster): string {
  return `SHOW TOOLS FROM \`${database.environmentId}\`.\`${database.id}\``;
}

/** Raw results type corresponding to `SHOW TOOLS` query */
export type RawFlinkAIToolRow = {
  "Tool Name": string;
};

/**
 * Transform raw tool rows from the `SHOW TOOLS` query into basic {@link FlinkAITool} objects.
 *
 * @param database What cluster these tools belong to
 * @param rawResults The raw rows from the `SHOW TOOLS` query
 * @returns Array of {@link FlinkAITool} objects, sorted by name.
 */
export function transformRawFlinkAIToolRows(
  database: CCloudFlinkDbKafkaCluster,
  rawResults: RawFlinkAIToolRow[],
): FlinkAITool[] {
  const tools: FlinkAITool[] = rawResults.map((row) => {
    return new FlinkAITool({
      environmentId: database.environmentId,
      provider: database.provider,
      region: database.region,
      databaseId: database.id,
      name: row["Tool Name"],
    });
  });

  tools.sort((a, b) => a.name.localeCompare(b.name));
  return tools;
}
