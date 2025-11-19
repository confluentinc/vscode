/** CCLoudResourceLoader Flink statement utils for AI Connections */
import { FlinkAIConnection } from "../../models/flinkAiConnection";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

/**
 * Generate the query to list all available Flink AI connections for a given Flink catalog+database.
 * @see https://docs.confluent.io/cloud/current/flink/reference/statements/show.html#flink-sql-show-connections
 */
export function getFlinkAIConnectionsQuery(database: CCloudFlinkDbKafkaCluster): string {
  return `SHOW CONNECTIONS FROM \`${database.environmentId}\`.\`${database.id}\``;
}

/** Raw results type corresponding to `SHOW CONNECTIONS` query */
export type RawFlinkAIConnectionRow = {
  "Connection Name": string;
};

/**
 * Transform raw connection rows from the `SHOW CONNECTIONS` query into basic {@link FlinkAIConnection} objects.
 *
 * @param database What cluster these connections belong to
 * @param rawResults The raw rows from the `SHOW CONNECTIONS` query
 * @returns Array of {@link FlinkAIConnection} objects, sorted by name.
 */
export function transformRawFlinkAIConnectionRows(
  database: CCloudFlinkDbKafkaCluster,
  rawResults: RawFlinkAIConnectionRow[],
): FlinkAIConnection[] {
  const connections: FlinkAIConnection[] = rawResults.map((row) => {
    return new FlinkAIConnection({
      environmentId: database.environmentId,
      provider: database.provider,
      region: database.region,
      databaseId: database.id,
      name: row["Connection Name"],
    });
  });

  connections.sort((a, b) => a.name.localeCompare(b.name));
  return connections;
}
