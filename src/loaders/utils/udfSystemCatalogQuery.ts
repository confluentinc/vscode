/** CCLoudResourceLoader Flink statement utils */

import { FlinkUdf, FlinkUdfParameter } from "../../models/flinkUDF";
import { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

import { Logger } from "../../logging";

const logger = new Logger("udfSystemCatalogQuery");

/**
 * Instantiate the UDF system catalog query for a given database (cluster) as the limiting "Flink Schema ID".
 *
 * @param database The database (cluster) to get UDFs for
 * @returns The SQL query string
 */
export function getUdfSystemCatalogQuery(database: CCloudFlinkDbKafkaCluster): string {
  /**
   * Query that unions together bits describing user-supplied functions and their parameters. The rows
   * will be of two types: those describing a function and those describing a parameter.  The two types
   * can be distinguished by the parameterOrdinalPosition being null (for function rows) or a number (for parameter rows).
   * The function rows will have details about the function itself, while the parameter rows will have details
   * about each parameter. The two can be joined on functionSpecificName.
   */
  return `
  (select
    SPECIFIC_NAME as \`functionSpecificName\`,
    ROUTINE_NAME as \`functionRoutineName\`,
    cast(null as int) as \`parameterOrdinalPosition\`,
    cast(null as string) as \`parameterName\`,
    FULL_DATA_TYPE as \`fullDataType\`,
    EXTERNAL_NAME as \`functionExternalName\`,
    EXTERNAL_LANGUAGE as \`functionExternalLanguage\`,
    EXTERNAL_ARTIFACTS as \`functionExternalArtifacts\`,
    IS_DETERMINISTIC as \`isDeterministic\`,
    cast(CREATED as string) as \`functionCreatedTs\`,
    FUNCTION_KIND as \`functionKind\`,
    cast(false as string) as \`isParameterOptional\`,
    cast(null as string)  as \`parameterTraits\`
  from \`INFORMATION_SCHEMA\`.\`ROUTINES\`
  where ROUTINE_TYPE = 'FUNCTION'
    and \`SPECIFIC_SCHEMA_ID\` = '${database.id}')

  union all

  (select
    SPECIFIC_NAME as \`functionSpecificName\`,
    ROUTINE_NAME as \`functionRoutineName\`,
    ORDINAL_POSITION as \`parameterOrdinalPosition\`,
    PARAMETER_NAME as \`parameterName\`,
    FULL_DATA_TYPE as \`fullDataType\`,
    cast(null as string) as \`functionExternalName\`,
    cast(null as string) as \`functionExternalLanguage\`,
    cast(null as string) as \`functionExternalArtifacts\`,
    cast(null as string) as \`isDeterministic\`,
    cast(null as string) as \`functionCreatedTs\`,
    cast(null as string) as \`functionKind\`,
    IS_OPTIONAL as \`isParameterOptional\`,
    TRAITS as \`parameterTraits\`
  from \`INFORMATION_SCHEMA\`.\`PARAMETERS\`
  WHERE \`SPECIFIC_SCHEMA_ID\` = '${database.id}')
  `;
}

/** Raw results type corresponding to UDF_SYSTEM_CATALOG_QUERY */
export type RawUdfSystemCatalogRow =
  | RawUdfSystemCatalogFunctionRow
  | RawUdfSystemCatalogParameterRow;

/** Describes rows from UDF_SYSTEM_CATALOG_QUERY describing the function as a whole */
export type RawUdfSystemCatalogFunctionRow = {
  /** Unique for function name + parameter signature */
  functionSpecificName: string;
  /** Function name */
  functionRoutineName: string;
  /** Name of the language-specific UDF implementation class / function */
  functionExternalName: string;
  /** Language the UDF is implemented in */
  functionExternalLanguage: string;
  /**
   * Artifact reference containing the implementation (only for the function row).
   * Will be of form "confluent-artifact://<artifact-id>/<version-id>"
   */
  functionExternalArtifacts: string;
  /** Whether the function is deterministic (only for the function row). Will be YES, NO, or null. */
  isDeterministic: string;
  /** Creation timestamp of the function (only for the function row) */
  functionCreatedTs: string;
  /**
   * One of 'SCALAR', 'TABLE', 'AGGREGATE', 'PROCESS_TABLE', or even null (if a PROCEDURE and the row describes the function, not a parameter), else null for parameter rows
   */
  functionKind: string | null;
  /** Full SQL data type of the return type for the function */
  fullDataType: string;
  /** Always null for function rows */
  parameterOrdinalPosition: null;
  /** Always null for function rows */
  parameterName: null;
  /** Always null for function rows */
  isParameterOptional: null;
  /** Always null for function rows */
  parameterTraits: null;
};

/** Describes rows from UDF_SYSTEM_CATALOG_QUERY describing a single parameter for a function */
export type RawUdfSystemCatalogParameterRow = {
  /** Unique for function name + parameter signature */
  functionSpecificName: string;
  /** Function name */
  functionRoutineName: string;
  /** Always null for parameter rows */
  functionExternalName: null;
  /** Always null for parameter rows */
  functionExternalLanguage: null;
  /** Always null for parameter rows */
  functionExternalArtifacts: null;
  /** Always null for parameter rows */
  isDeterministic: null;
  /** Always null for parameter rows */
  functionCreatedTs: null;
  /** Always null for parameter rows */
  functionKind: null;
  /** Full SQL data type of the parameter */
  fullDataType: string;
  /** Parameter number if describing a parameter */
  parameterOrdinalPosition: number;
  /** Parameter name if describing a parameter */
  parameterName: string;
  /** Is this parameter optional? Will be YES, NO, or null */
  isParameterOptional: string;
  /** Semicolon separated list of traits. By default, SCALAR only. */
  parameterTraits: string;
};

/**
 * Parse raw UDF system catalog rows into FlinkUdf objects, one per function, with parameters populated.
 * The input rows should be the result of UDF_SYSTEM_CATALOG_QUERY.
 *
 * @param database What cluster these UDFs belong to
 * @param rawResults The raw rows from the UDF system catalog query, will be either function-describing rows (RawUdfSystemCatalogFunctionRow) or parameter-describing (RawUdfSystemCatalogParameterRow) rows.
 * @returns Array of FlinkUdf objects sorted by their id (functionSpecificName).
 */
export function transformUdfSystemCatalogRows(
  database: CCloudFlinkDbKafkaCluster,
  rawResults: RawUdfSystemCatalogRow[],
): FlinkUdf[] {
  logger.debug(
    `Transforming ${rawResults.length} raw UDF system catalog rows for cluster ${database.name} (${database.id})`,
  );

  /*
   * This is done in the general style of a SAX parser, in that we process each row in order,
   * accumulating parameter details as we go, and when we hit a function-describing row,
   * we know to push the current parameters into a new FlinkUdf object.
   *
   * We sort the rows first by functionSpecificName, then by parameterOrdinalPosition (with nulls first so the function-describing
   * row comes first). This ensures that all rows for a given function are together, with the function row first,
   * followed by its parameters in order.
   */

  const sortedRows = sortUdfSystemCatalogRows(rawResults);

  let udfs: FlinkUdf[] = [];

  // Will convert the raw rows into FlinkUdf objects, one per specific function overload, by
  // accumulating parameter details as we go, then knowing to push the current
  // parameter array into a new FlinkUdf object when we hit the null parameter position
  // row (i.e. the function row).
  let currentParameters: FlinkUdfParameter[] = [];
  let currentUDF: FlinkUdf | null = null;
  const seenfunctionSpecificNames = new Set<string>();
  const currentParameterPositions = new Set<number>();

  for (const row of sortedRows) {
    if (row.parameterOrdinalPosition === null) {
      // Is a RawUdfSystemCatalogFunctionRow instance describing a new function overload.

      // Create new UDF, append it to the list.

      // Keep shared reference to currentParameters so we can add to it as we go
      // when we see parameter rows for this function.
      if (seenfunctionSpecificNames.has(row.functionSpecificName)) {
        // This should never happen due to the sorting above, but just in case...
        throw new Error(
          `Duplicate functionSpecificName ${row.functionSpecificName} in UDF system catalog results`,
        );
      }
      seenfunctionSpecificNames.add(row.functionSpecificName);

      // Reset current parameter tracking state.
      currentParameters = [];
      currentParameterPositions.clear();

      currentUDF = new FlinkUdf({
        environmentId: database.environmentId,
        provider: database.provider,
        region: database.region,
        databaseId: database.id,

        id: row.functionSpecificName, // Unique for function name + parameter signature
        name: row.functionRoutineName,
        externalName: row.functionExternalName,
        language: row.functionExternalLanguage,
        artifactReference: row.functionExternalArtifacts,
        isDeterministic: row.isDeterministic === "YES",
        creationTs: new Date(row.functionCreatedTs + "Z"),
        kind: row.functionKind,
        returnType: row.fullDataType,

        description: "", // for now. Perhaps determine from language-specific docstring later?
        parameters: currentParameters, // retain reference so we can add to it as we go.
      });

      udfs.push(currentUDF);
    } else {
      // Parameter row for the current function, so add to currentParameters.

      if (currentUDF === null || currentUDF.id !== row.functionSpecificName) {
        throw new Error(
          `Unexpected parameter row for unknown functionSpecificName ${row.functionSpecificName} when current UDF is ${currentUDF?.id}`,
        );
      }

      if (currentParameterPositions.has(row.parameterOrdinalPosition)) {
        throw new Error(
          `Duplicate parameter position ${row.parameterOrdinalPosition} for functionSpecificName ${row.functionSpecificName} in UDF system catalog results`,
        );
      }

      // Add parameter to currentParameters array. They're already in order due to the sorting above.
      const param: FlinkUdfParameter = {
        name: row.parameterName,
        dataType: row.fullDataType,
        isOptional: row.isParameterOptional === "YES",
        traits: row.parameterTraits
          ? row.parameterTraits
              .split(";")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
          : [],
      };
      currentParameters.push(param);
      currentParameterPositions.add(row.parameterOrdinalPosition);
    }
  }

  logger.debug(`Transformed to ${udfs.length} FlinkUdf objects`);

  return udfs;
}

/**
 * Sorts RawUdfSystemCatalogRow[] by functionSpecificName, then by parameterOrdinalPosition,
 * with function rows (parameterOrdinalPosition === null) first in each group.
 */
export function sortUdfSystemCatalogRows(rows: RawUdfSystemCatalogRow[]): RawUdfSystemCatalogRow[] {
  return rows.sort((a, b) => {
    if (a.functionSpecificName < b.functionSpecificName) return -1;
    if (a.functionSpecificName > b.functionSpecificName) return 1;
    // Same function name, so sort by parameter position (nulls first so the main function-describing
    // row comes first (will have null parameterOrdinalPosition))
    if (a.parameterOrdinalPosition === null && b.parameterOrdinalPosition !== null) return -1;
    if (a.parameterOrdinalPosition !== null && b.parameterOrdinalPosition === null) return 1;
    if (a.parameterOrdinalPosition === null && b.parameterOrdinalPosition === null) return 0;
    // Both non-null
    return a.parameterOrdinalPosition! - b.parameterOrdinalPosition!;
  });
}
