import { Logger } from "../../logging";
import {
  FlinkRelation,
  FlinkRelationColumn,
  FlinkRelationType,
  toRelationType,
} from "../../models/flinkSystemCatalog";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";

const logger = new Logger("relationsAndColumnsSystemCatalogQuery");

export function getRelationsAndColumnsSystemCatalogQuery(
  database: CCloudFlinkDbKafkaCluster,
): string {
  return `
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

export type RawRelationsAndColumnsRow = RawRelationRow | RawColumnRow;

/**
 * Parses mixed relation + column rows into structured Relation objects.
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
  let mostRecentRelationName = "";

  let currentColumns: FlinkRelationColumn[] | undefined = undefined;

  for (const row of rows) {
    if (row.rowType === "relation") {
      const newRelation: FlinkRelation = new FlinkRelation({
        name: row.relationName,
        comment: row.relationComment,
        type: toRelationType(row.relationType),
        distributionBucketCount: row.relationDistributionBucketCount,
        isDistributed: row.relationIsDistributed === "YES",
        isWatermarked: row.relationIsWatermarked === "YES",
        watermarkColumn: row.relationWatermarkColumn,
        watermarkExpression: row.relationWatermarkExpression,
        watermarkColumnIsHidden: row.relationWatermarkColumnIsHidden === "YES",
        columns: [],
      });
      relations.push(newRelation);
      mostRecentRelationName = row.relationName;
      currentColumns = newRelation.columns;
    } else {
      if (row.relationName !== mostRecentRelationName || !currentColumns) {
        const message = `Column ${row.columnName} for relation ${row.relationName} does not match current relation "${mostRecentRelationName}"!`;
        logger.error(message);
        throw new Error(message);
      }

      currentColumns.push(
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
 * then by column number with null (table rows) first.
 */
function sortRawRelationsAndColumnsRows(rows: RawRelationsAndColumnsRow[]): void {
  rows.sort((a, b) => {
    if (a.relationName !== b.relationName) {
      return a.relationName.localeCompare(b.relationName);
    }
    // Both belong to same relation: ensure relation (null columnNumber) comes first
    const aNum = (a as RawColumnRow).columnNumber;
    const bNum = (b as RawColumnRow).columnNumber;
    if (aNum === bNum) return 0;
    if (aNum === null) return -1;
    if (bNum === null) return 1;
    return aNum - bNum;
  });
}
