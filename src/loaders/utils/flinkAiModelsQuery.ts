/** CCLoudResourceLoader Flink statement utils for AI Models */
import { FlinkAIModel } from "../../models/flinkAiModel";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

/**
 * Generate the query to list all available Flink AI models for a given Flink catalog+database.
 * @see https://docs.confluent.io/cloud/current/flink/reference/statements/show.html#flink-sql-show-models
 */
export function getFlinkAIModelsQuery(database: CCloudFlinkDbKafkaCluster): string {
  return `SHOW MODELS FROM \`${database.environmentId}\`.\`${database.id}\``;
}

/** Raw results type corresponding to `SHOW MODELS` query */
export type RawFlinkAIModelRow = {
  "Model Name": string;
};

/**
 * Transform raw model rows from the `SHOW MODELS` query into basic {@link FlinkAIModel} objects.
 *
 * @param database What cluster these models belong to
 * @param rawResults The raw rows from the `SHOW MODELS` query
 * @returns Array of {@link FlinkAIModel} objects, sorted by name.
 */
export function transformRawFlinkAIModelRows(
  database: CCloudFlinkDbKafkaCluster,
  rawResults: RawFlinkAIModelRow[],
): FlinkAIModel[] {
  const models: FlinkAIModel[] = rawResults.map((row) => {
    return new FlinkAIModel({
      environmentId: database.environmentId,
      provider: database.provider,
      region: database.region,
      databaseId: database.id,
      name: row["Model Name"],
    });
  });

  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}
