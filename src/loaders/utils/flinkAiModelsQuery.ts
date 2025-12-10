/** CCLoudResourceLoader Flink statement utils for AI Models */
import { Logger } from "../../logging";
import { FlinkAIModel } from "../../models/flinkAiModel";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

const logger = new Logger("flinkAiModelsQuery");

/**
 * Generate the query to list all available Flink AI models for a given Flink catalog+database.
 * Uses INFORMATION_SCHEMA to get detailed model information including default version, version count, and comment.
 * @see https://docs.confluent.io/cloud/current/flink/reference/flink-sql-information-schema.html#models
 */
export function getFlinkAIModelsQuery(database: CCloudFlinkDbKafkaCluster): string {
  return `
    -- Model toplevel definitions
    select
    'model' as \`rowType\`,
    \`MODEL_NAME\` as \`modelName\`,
    \`DEFAULT_VERSION\` as \`defaultVersion\`,
    \`VERSION_COUNT\` as \`versionCount\`,
    \`COMMENT\` as \`comment\`,
    CAST(NULL AS STRING) as \`optionKey\`,
    CAST(NULL AS STRING) as \`optionValue\`,
    CAST(NULL AS STRING) as \`version\`
    from \`INFORMATION_SCHEMA\`.\`MODELS\`
    where \`MODEL_SCHEMA_ID\` = '${database.id}'

    union all

    -- Model options (WITH clause configuration)
    select
    'modelOption' as \`rowType\`,
    \`MODEL_NAME\` as \`modelName\`,
    CAST(NULL AS STRING) as \`defaultVersion\`,
    CAST(NULL AS INT) as \`versionCount\`,
    CAST(NULL AS STRING) as \`comment\`,
    \`OPTION_KEY\` as \`optionKey\`,
    \`OPTION_VALUE\` as \`optionValue\`,
    \`VERSION\` as \`version\`
    from \`INFORMATION_SCHEMA\`.\`MODEL_OPTIONS\`
    where \`MODEL_SCHEMA_ID\` = '${database.id}'
  `;
}

/** Describes rows from the models query describing the model as a whole */
export interface RawModelRow {
  rowType: "model";
  modelName: string;
  defaultVersion: string;
  versionCount: number;
  comment: string | null;
  optionKey: null;
  optionValue: null;
  version: null;
}

/** Describes rows from the models query describing a single option for a model */
export interface RawModelOptionRow {
  rowType: "modelOption";
  modelName: string;
  defaultVersion: null;
  versionCount: null;
  comment: null;
  optionKey: string;
  optionValue: string;
  version: string;
}

/** Raw results type corresponding to the models INFORMATION_SCHEMA query */
export type RawFlinkAIModelRow = RawModelRow | RawModelOptionRow;

/**
 * Transform raw model rows from the INFORMATION_SCHEMA models query into {@link FlinkAIModel} objects.
 * Processes mixed model definition rows and model option rows to build complete model objects with their options.
 *
 * @param database What cluster these models belong to
 * @param rawResults The raw rows from the INFORMATION_SCHEMA models query (both model and modelOption rows)
 * @returns Array of {@link FlinkAIModel} objects, sorted by name.
 */
export function transformRawFlinkAIModelRows(
  database: CCloudFlinkDbKafkaCluster,
  rawResults: RawFlinkAIModelRow[],
): FlinkAIModel[] {
  logger.debug(
    `Transforming ${rawResults.length} raw model rows for cluster ${database.name} (${database.id})`,
  );

  // Sort rows to ensure model definition comes before its options
  sortRawModelRows(rawResults);

  const models: FlinkAIModel[] = [];
  let currentModel: FlinkAIModel | null = null;
  const seenModelNames = new Set<string>();

  for (const row of rawResults) {
    if (row.rowType === "model") {
      // Create new model
      if (seenModelNames.has(row.modelName)) {
        throw new Error(`Duplicate model name ${row.modelName} in INFORMATION_SCHEMA results`);
      }
      seenModelNames.add(row.modelName);

      currentModel = new FlinkAIModel({
        environmentId: database.environmentId,
        provider: database.provider,
        region: database.region,
        databaseId: database.id,
        name: row.modelName,
        defaultVersion: row.defaultVersion,
        versionCount: row.versionCount,
        comment: row.comment,
        options: new Map(),
      });

      models.push(currentModel);
    } else {
      // Model option row
      if (currentModel === null || currentModel.name !== row.modelName) {
        throw new Error(
          `Unexpected model option row for model ${row.modelName} when current model is ${currentModel?.name}`,
        );
      }

      // Add option to current model's options map, keyed by version
      const versionKey = row.version || "default";
      if (!currentModel.options.has(versionKey)) {
        currentModel.options.set(versionKey, new Map());
      }
      const optionsMap = currentModel.options.get(versionKey)!;
      optionsMap.set(row.optionKey, row.optionValue);
    }
  }

  logger.debug(`Transformed to ${models.length} FlinkAIModel objects`);

  // Sort models by name
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

/**
 * Sorts RawFlinkAIModelRow[] by modelName, then by rowType (model rows first).
 * This ensures that each model's definition row comes before its option rows.
 */
function sortRawModelRows(rows: RawFlinkAIModelRow[]): void {
  rows.sort((a, b) => {
    // First sort by model name
    if (a.modelName !== b.modelName) {
      return a.modelName.localeCompare(b.modelName);
    }

    // Then sort by row type (model rows first)
    return rowRank(a) - rowRank(b);
  });
}

/** Assist in sorting the row types: model rows come before option rows */
function rowRank(row: RawFlinkAIModelRow): number {
  switch (row.rowType) {
    case "model":
      return 0;
    case "modelOption":
      return 1;
  }
}
