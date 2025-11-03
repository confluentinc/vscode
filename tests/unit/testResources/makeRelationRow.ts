import type {
  RawColumnRow,
  RawRelationRow,
} from "../../../src/loaders/utils/relationsAndColumnsSystemCatalogQuery";

export function makeRelationRow(
  name: string,
  opts: {
    comment?: string | null;
    type?: string;
    distributionBucketCount?: number;
    isDistributed?: "YES" | "NO";
    isWatermarked?: "YES" | "NO";
    watermarkColumn?: string | null;
    watermarkExpression?: string | null;
    watermarkColumnIsHidden?: "YES" | "NO";
  } = {},
): RawRelationRow {
  return {
    rowType: "relation",
    relationName: name,
    relationComment: opts.comment ?? null,
    relationType: opts.type ?? "BASE TABLE",
    relationDistributionBucketCount: opts.distributionBucketCount ?? 0,
    relationIsDistributed: opts.isDistributed ?? "NO",
    relationIsWatermarked: opts.isWatermarked ?? "NO",
    relationWatermarkColumn: opts.watermarkColumn ?? null,
    relationWatermarkExpression: opts.watermarkExpression ?? null,
    relationWatermarkColumnIsHidden: opts.watermarkColumnIsHidden ?? "NO",

    columnName: null,
    columnNumber: null,
    columnDataType: null,
    columnFullDataType: null,
    columnIsNullable: null,
    columnComment: null,
    columnDistributionKeyNumber: null,
    columnIsGenerated: null,
    columnIsPersisted: null,
    columnIsHidden: null,
    columnIsMetadata: null,
    columnMetadataKey: null,
  };
}

export function makeColumnRow(
  relationName: string,
  columnName: string,
  position: number,
  opts: {
    dataType?: string;
    fullDataType?: string;
    isNullable?: "YES" | "NO";
    comment?: string | null;
    distributionKeyNumber?: number | null;
    isGenerated?: "YES" | "NO";
    isPersisted?: "YES" | "NO";
    isHidden?: "YES" | "NO";
    isMetadata?: "YES" | "NO";
    metadataKey?: string | null;
  } = {},
): RawColumnRow {
  return {
    rowType: "column",
    relationName: relationName,
    relationComment: null,
    relationType: null,
    relationDistributionBucketCount: null,
    relationIsDistributed: null,
    relationIsWatermarked: null,
    relationWatermarkColumn: null,
    relationWatermarkExpression: null,
    relationWatermarkColumnIsHidden: null,

    columnName: columnName,
    columnNumber: position,
    columnDataType: opts.dataType ?? "VARCHAR",
    columnFullDataType: opts.fullDataType ?? "VARCHAR(255)",
    columnIsNullable: opts.isNullable ?? "YES",
    columnComment: opts.comment ?? null,
    columnDistributionKeyNumber: opts.distributionKeyNumber ?? null,
    columnIsGenerated: opts.isGenerated ?? "NO",
    columnIsPersisted: opts.isPersisted ?? "YES",
    columnIsHidden: opts.isHidden ?? "NO",
    columnIsMetadata: opts.isMetadata ?? "NO",
    columnMetadataKey: opts.metadataKey ?? null,
  };
}
