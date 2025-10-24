import { Logger } from "../../logging";
import {
  FlinkRelation,
  FlinkRelationColumn,
  FlinkRelationType,
  toRelationType,
} from "../../models/flinkRelation";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

const logger = new Logger("relationsAndColumnsSystemCatalogQuery");

export function getRelationsAndColumnsSystemCatalogQuery(
  database: CCloudFlinkDbKafkaCluster,
): string {
  return `
    -- First portion gets relations overall definitions (tables, views, etc.) -- the singular facts about each relation
    -- Second portion gets view definitions (for the relations that are views)
    -- Third portion gets columns (of all relations)

    -- Relation (table / view / etc.) toplevel definitions.
    select
    'relation' as \`rowType\`,

    \`TABLE_NAME\` as \`relationName\`,
    \`COMMENT\` as \`relationComment\`,
    \`TABLE_TYPE\` as \`relationType\`,
    \`DISTRIBUTION_BUCKETS\` as \`relationDistributionBucketCount\`,
    \`IS_DISTRIBUTED\` as \`relationIsDistributed\`,
    \`IS_WATERMARKED\` as \`relationIsWatermarked\`,
    \`WATERMARK_COLUMN\` as \`relationWatermarkColumn\`,
    \`WATERMARK_EXPRESSION\` as \`relationWatermarkExpression\`,
    \`WATERMARK_IS_HIDDEN\` as \`relationWatermarkColumnIsHidden\`,

    CAST(NULL AS STRING) as \`viewDefinition\`,

    CAST(NULL AS STRING) as \`columnName\`,
    CAST(NULL AS INT) as \`columnNumber\`,
    CAST(NULL AS STRING) as \`columnDataType\`,
    CAST(NULL AS STRING) as \`columnFullDataType\`,
    CAST(NULL AS STRING) as \`columnIsNullable\`,
    CAST(NULL AS STRING) as \`columnComment\`,
    CAST(NULL AS INT) as \`columnDistributionKeyNumber\`,
    CAST(NULL AS STRING) as \`columnIsGenerated\`,
    CAST(NULL AS STRING) as \`columnIsPersisted\`,
    CAST(NULL AS STRING) as \`columnIsHidden\`,
    CAST(NULL AS STRING) as \`columnIsMetadata\`,
    CAST(NULL AS STRING) as \`columnMetadataKey\`

    from \`INFORMATION_SCHEMA\`.\`TABLES\`
    where
        \`TABLE_SCHEMA_ID\` = '${database.id}'


    union all 

    -- View definitions

    select 
    'viewDefinition' as \`rowType\`,
    \`TABLE_NAME\` as \`relationName\`,
    CAST(NULL AS STRING) as \`relationComment\`,
    CAST(NULL AS STRING) as \`relationIsTable\`,
    CAST(NULL AS INT) as \`relationDistributionBucketCount\`,
    CAST(NULL AS STRING) as \`relationIsDistributed\`,
    CAST(NULL AS STRING) as \`relationIsWatermarked\`,
    CAST(NULL AS STRING) as \`relationWatermarkColumn\`,
    CAST(NULL AS STRING) as \`relationWatermarkExpression\`,
    CAST(NULL AS STRING) as \`relationWatermarkColumnIsHidden\`,
    
    \`VIEW_DEFINITION\` as \`viewDefinition\`,
    
    CAST(NULL AS STRING) as \`columnName\`,
    CAST(NULL AS INT) as \`columnNumber\`,
    CAST(NULL AS STRING) as \`columnDataType\`,
    CAST(NULL AS STRING) as \`columnFullDataType\`,
    CAST(NULL AS STRING) as \`columnIsNullable\`,
    CAST(NULL AS STRING) as \`columnComment\`,
    CAST(NULL AS INT) as \`columnDistributionKeyNumber\`,
    CAST(NULL AS STRING) as \`columnIsGenerated\`,
    CAST(NULL AS STRING) as \`columnIsPersisted\`,
    CAST(NULL AS STRING) as \`columnIsHidden\`,
    CAST(NULL AS STRING) as \`columnIsMetadata\`,
    CAST(NULL AS STRING) as \`columnMetadataKey\`

    from \`INFORMATION_SCHEMA\`.\`VIEWS\`
    where
        \`TABLE_SCHEMA_ID\` = '${database.id}'

    union all 

    -- Column definitions.
    select 
    'column' as \`rowType\`,

    \`TABLE_NAME\` as \`relationName\`,
    CAST(NULL AS STRING) as \`relationComment\`,
    CAST(NULL AS STRING) as \`relationIsTable\`,
    CAST(NULL AS INT) as \`relationDistributionBucketCount\`,
    CAST(NULL AS STRING) as \`relationIsDistributed\`,
    CAST(NULL AS STRING) as \`relationIsWatermarked\`,
    CAST(NULL AS STRING) as \`relationWatermarkColumn\`,
    CAST(NULL AS STRING) as \`relationWatermarkExpression\`,
    CAST(NULL AS STRING) as \`relationWatermarkColumnIsHidden\`,

    CAST(NULL AS STRING) as \`viewDefinition\`,

    \`COLUMN_NAME\` as \`columnName\`,
    \`ORDINAL_POSITION\` as \`columnNumber\`,
    \`DATA_TYPE\` as \`columnDataType\`,
    \`FULL_DATA_TYPE\` as \`columnFullDataType\`,
    \`IS_NULLABLE\` as \`columnIsNullable\`,
    \`COMMENT\` as \`columnComment\`,
    \`DISTRIBUTION_ORDINAL_POSITION\` as \`columnDistributionKeyNumber\`,
    \`IS_GENERATED\` as \`columnIsGenerated\`,
    \`IS_PERSISTED\` as \`columnIsPersisted\`,
    \`IS_HIDDEN\` as \`columnIsHidden\`,
    \`IS_METADATA\` as \`columnIsMetadata\`,
    \`METADATA_KEY\` as \`columnMetadataKey\`

    from \`INFORMATION_SCHEMA\`.\`COLUMNS\`
    where
        \`TABLE_SCHEMA_ID\` = '${database.id}'



`;
}

type StringBoolean = "YES" | "NO";

export interface RawRelationRow {
  rowType: "relation";
  relationName: string;
  relationComment: string | null;
  relationType: string;
  relationDistributionBucketCount: number;
  relationIsDistributed: StringBoolean;
  relationIsWatermarked: StringBoolean;
  relationWatermarkColumn: string | null;
  relationWatermarkExpression: string | null;
  relationWatermarkColumnIsHidden: StringBoolean;
  viewDefinition: null;

  columnName: null;
  columnNumber: null;
  columnDataType: null;
  columnFullDataType: null;
  columnIsNullable: null;
  columnComment: null;
  columnDistributionKeyNumber: null;
  columnIsGenerated: null;
  columnIsPersisted: null;
  columnIsHidden: null;
  columnIsMetadata: null;
  columnMetadataKey: null;
}

export interface RawColumnRow {
  rowType: "column";
  relationName: string;
  relationComment: null;
  relationType: null;
  relationDistributionBucketCount: null;
  relationIsDistributed: null;
  relationIsWatermarked: null;
  relationWatermarkColumn: null;
  relationWatermarkExpression: null;
  relationWatermarkColumnIsHidden: null;
  viewDefinition: null;

  columnName: string;
  columnNumber: number;
  columnDataType: string;
  columnFullDataType: string;
  columnIsNullable: StringBoolean;
  columnComment: string | null;
  columnDistributionKeyNumber: number | null;
  columnIsGenerated: StringBoolean;
  columnIsPersisted: StringBoolean;
  columnIsHidden: StringBoolean;
  columnIsMetadata: StringBoolean;
  columnMetadataKey: string | null;
}

export interface RawViewDefinitionRow {
  rowType: "viewDefinition";
  relationName: string;
  relationComment: null;
  relationType: null;
  relationDistributionBucketCount: null;
  relationIsDistributed: null;
  relationIsWatermarked: null;
  relationWatermarkColumn: null;
  relationWatermarkExpression: null;
  relationWatermarkColumnIsHidden: null;
  viewDefinition: string | null; // Docs say this can be null if the user does not have access to see the view definition.

  columnName: null;
  columnNumber: null;
  columnDataType: null;
  columnFullDataType: null;
  columnIsNullable: null;
  columnComment: null;
  columnDistributionKeyNumber: null;
  columnIsGenerated: null;
  columnIsPersisted: null;
  columnIsHidden: null;
  columnIsMetadata: null;
  columnMetadataKey: null;
}

export type RawRelationsAndColumnsRow = RawRelationRow | RawColumnRow | RawViewDefinitionRow;

/**
 * Parses mixed relation + column + view definition rows into structured Relation objects.
 * Processing:
 * 1. Sort rows by relation (table) name ASC, then by column number ASC with null (relation rows) first.
 * 2. Iterate in order, creating a new Relation when a relation row is encountered, then attaching its columns.
 * 3. Column rows without a preceding relation row are cause for an error.
 */
export function parseRelationsAndColumnsSystemCatalogQueryResponse(
  rows: RawRelationsAndColumnsRow[],
): FlinkRelation[] {
  // Sorts in-place to ensure relations come before their columns and all columns for a relation are together.
  sortRawRelationsAndColumnsRows(rows);

  const relations: FlinkRelation[] = [];
  let currentRelation: FlinkRelation | undefined = undefined;

  for (const row of rows) {
    if (row.rowType === "relation") {
      const newRelation: FlinkRelation = new FlinkRelation({
        name: row.relationName,
        comment: row.relationComment,
        type: toRelationType(row.relationType),
        distributionBucketCount: row.relationDistributionBucketCount,
        isDistributed: row.relationIsDistributed === "YES",
        isWatermarked: row.relationIsWatermarked === "YES",
        watermarkColumnName: row.relationWatermarkColumn,
        watermarkExpression: row.relationWatermarkExpression,
        watermarkColumnIsHidden: row.relationWatermarkColumnIsHidden === "YES",
        columns: [],
      });
      relations.push(newRelation);
      currentRelation = newRelation;
    } else if (row.rowType === "viewDefinition") {
      // Should be for the most recent relation, otherwise the sorting is off.
      if (row.relationName !== currentRelation?.name) {
        const message = `View definition for relation ${row.relationName} does not match current relation "${currentRelation?.name}"!`;
        logger.error(message);
        throw new Error(message);
      }
      // Attach view definition to current relation
      currentRelation.viewDefinition = row.viewDefinition;
    } else {
      // Column row
      if (row.relationName !== currentRelation?.name) {
        const message = `Column ${row.columnName} for relation ${row.relationName} does not match current relation "${currentRelation?.name}"!`;
        logger.error(message);
        throw new Error(message);
      }

      currentRelation.columns.push(
        new FlinkRelationColumn({
          relationName: row.relationName,
          name: row.columnName,
          fullDataType: row.columnFullDataType,
          isNullable: row.columnIsNullable === "YES",
          distributionKeyNumber: row.columnDistributionKeyNumber,
          isGenerated: row.columnIsGenerated === "YES",
          isPersisted: row.columnIsPersisted === "YES",
          isHidden: row.columnIsHidden === "YES",
          metadataKey: row.columnMetadataKey,
          comment: row.columnComment,
        }),
      );
    }
  }

  // For now (Oct 2025), until they become actually readable, filter out system tables.
  return relations.filter((r) => r.type !== FlinkRelationType.SystemTable);
}

/**
 * In-place sort the intermixed table + column raw rows by table name highest priority,
 * then by any possible view definition row, then lastly by column number with null (table rows) first.
 */
function sortRawRelationsAndColumnsRows(rows: RawRelationsAndColumnsRow[]): void {
  rows.sort((a, b) => {
    // First sort by relation name ascending
    if (a.relationName !== b.relationName) {
      return a.relationName.localeCompare(b.relationName);
    }

    // Then sort by row type rank
    const aRank = rowRank(a);
    const bRank = rowRank(b);
    if (aRank !== bRank) {
      return aRank - bRank;
    }

    // Only columns reach here (multiple rows same type + same rank); sort by columnNumber ascending
    if (a.rowType === "column" && b.rowType === "column") {
      return a.columnNumber - b.columnNumber;
    }
    return 0;
  });
}

/** Assist in sorting the major row types. */
function rowRank(row: RawRelationsAndColumnsRow): number {
  switch (row.rowType) {
    case "relation":
      return 0;
    case "viewDefinition":
      return 1;
    case "column":
      return 2;
  }
}
