import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { Logger } from "../logging";
import { CustomMarkdownString, IdItem } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

const logger = new Logger("models.FlinkSystemCatalog");

export class FlinkUdfParameter {
  name: string;
  dataType: string;
  isOptional: boolean;
  traits: string[];

  constructor(props: Pick<FlinkUdfParameter, "name" | "dataType" | "isOptional" | "traits">) {
    this.name = props.name;
    this.dataType = props.dataType;
    this.isOptional = props.isOptional;
    this.traits = props.traits;
  }
}

export class FlinkUdf implements IResourceBase, IdItem, ISearchable {
  /** What CCloud environment this UDF came from (from the Kafka Cluster) */
  environmentId: EnvironmentId;
  /** What cloud provider hosts the parent Kafka Cluster? */
  provider: string;
  /** What cloud region hosts the parent Kafka Cluster? */
  region: string;
  /** The Flinkable CCloud Kafka Cluster id the UDF belongs to. */
  databaseId: string;

  /** Unique id string within this database, even considering function overloading */
  id: string;
  /** The function name (not necessarily unique due to overloading) */
  name: string;
  language: string; // e.g. "JAVA" or "PYTHON"
  /** The name of the implementation routine in the external language */
  externalName: string;
  /** Artifact containing the UDF implementation. Should be parsed down to its artifact ID sooner or later */
  artifactReference: string;

  /** Is the function deterministic? */
  isDeterministic: boolean;

  /** When the function was created */
  creationTs: Date;

  /** One of 'SCALAR', 'TABLE', 'AGGREGATE', 'PROCESS_TABLE'. Will be null for PROCEDURE*/
  kind: string | null;

  /** Return type full SQL name */
  returnType: string;

  /** The function parameters (in order) */
  parameters: FlinkUdfParameter[] = [];
  description: string;
  iconName: IconNames = IconNames.FLINK_FUNCTION;

  constructor(
    props: Pick<
      FlinkUdf,
      | "environmentId"
      | "provider"
      | "region"
      | "databaseId"
      | "id"
      | "name"
      | "description"
      | "language"
      | "externalName"
      | "isDeterministic"
      | "artifactReference"
      | "creationTs"
      | "parameters"
      | "kind"
      | "returnType"
    >,
  ) {
    // From the parent Kafka cluster:
    this.environmentId = props.environmentId;
    this.provider = props.provider;
    this.region = props.region;
    this.databaseId = props.databaseId;

    // From the UDF itself:
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.language = props.language;
    this.externalName = props.externalName;
    this.artifactReference = props.artifactReference;
    this.isDeterministic = props.isDeterministic;
    this.creationTs = new Date(props.creationTs);
    this.kind = props.kind;
    this.returnType = props.returnType;

    this.parameters = props.parameters;
  }

  searchableText(): string {
    const parts = [];

    parts.push(this.name);
    parts.push(this.description);
    parts.push(this.externalName);
    // in near future, break down artifact reference into id and version via new getters and/or parse at construction time.
    parts.push(this.artifactReference);
    parts.push(this.kind ?? "");

    return parts.join(" ");
  }

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  get artifactReferenceExtracted(): string {
    // Extract artifact ID and version from "confluent-artifact://<artifact-id>/<version-id>"
    return this.artifactReference.replace(/^confluent-artifact:\/\//, "");
  }

  /** Returns a formatted string of the function parameters' signatures. */
  get parametersSignature(): string {
    return (
      "(" + this.parameters.map((p) => `${p.name} : ${formatSqlType(p.dataType)}`).join(", ") + ")"
    );
  }
}

/** Represents a column of a Flink table or view. */
export class FlinkRelationColumn {
  /** Name of the containing relation */
  readonly relationName: string;
  /** Name of the column */
  readonly name: string;
  /** SQL data type of the column */
  readonly dataType: string;
  /** Full SQL data type of the column. */
  readonly fullDataType: string;
  /** Is the column nullable? */
  readonly isNullable: boolean;
  /** If part of distribution key, what number in the key is it? (1-based) */
  readonly distributionKeyNumber: number | null;
  /** Is the column a generated column? */
  readonly isGenerated: boolean;
  /** Is the column persisted (stored on disk)? */
  readonly isPersisted: boolean;
  /** Is the column hidden (not normally visible)? */
  readonly isHidden: boolean;

  /** If a metadata column, what Kafka topic metadata key does it map to? */
  readonly metadataKey: string | null;

  constructor(
    props: Pick<
      FlinkRelationColumn,
      | "relationName"
      | "name"
      | "dataType"
      | "fullDataType"
      | "isNullable"
      | "distributionKeyNumber"
      | "isGenerated"
      | "isPersisted"
      | "isHidden"
      | "metadataKey"
    >,
  ) {
    this.relationName = props.relationName;
    this.name = props.name;
    this.dataType = props.dataType;
    this.fullDataType = props.fullDataType;
    this.isNullable = props.isNullable;
    this.distributionKeyNumber = props.distributionKeyNumber;
    this.isGenerated = props.isGenerated;
    this.isPersisted = props.isPersisted;
    this.isHidden = props.isHidden;
    this.metadataKey = props.metadataKey;

    if (this.fullDataType.startsWith("ROW<")) {
      logger.info(
        `Column ${this.name} in relation ${this.relationName} has complex ROW type: ${this.fullDataType}`,
      );
    }
  }

  get id(): string {
    return `${this.relationName}.${this.name}`;
  }

  get simpleDataType(): string {
    let type = this.dataType;

    // if is an array, strip off the ARRAY<> to get to the inner type
    if (type.startsWith("ARRAY<")) {
      type = type.substring(6, this.dataType.length - 1).trim();
    }
    // if is a ROW<...> type, just return "ROW"
    if (type.startsWith("ROW<")) {
      return "ROW";
    }

    return this.dataType;
  }

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  /** Is this column an array type? */
  get isArray(): boolean {
    return this.dataType.startsWith("ARRAY<");
  }

  /** Return the basic datatype sans ARRAY<> decoration. */
  get typeWithoutArray(): string {
    if (this.isArray) {
      // ARRAY<type> -> type
      return this.dataType.substring(6, this.dataType.length - 1).trim();
    }
    return this.dataType;
  }

  searchableText(): string {
    const parts = [];

    parts.push(this.name);
    parts.push(this.dataType);
    if (this.metadataKey) {
      parts.push(this.metadataKey);
    }

    return parts.join(" ");
  }

  /** Is this column a metadata column? */
  get isMetadata(): boolean {
    return this.metadataKey !== null;
  }

  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name, TreeItemCollapsibleState.None);
    item.iconPath = new ThemeIcon(IconNames.FLINK_FUNCTION); // TODO replace with column specific icon when available
    item.id = this.id;
    item.contextValue = "ccloud-flink-column";
    item.tooltip = this.getToolTip();
    item.description = formatSqlType(this.simpleDataType);
    if (this.isArray) {
      item.description += "[]";
    }
    return item;
  }

  getToolTip(): CustomMarkdownString {
    const tooltip = new CustomMarkdownString()
      .addHeader("Flink Column", IconNames.FLINK_FUNCTION) // TODO replace with column specific icon when available
      .addField("Name", this.name)
      .addField("Data Type", formatSqlType(this.fullDataType))
      .addField("Nullable", this.isNullable ? "Yes" : "No")
      .addField("Persisted", this.isPersisted ? "Yes" : "No");

    if (this.isArray) {
      tooltip.addField("Array", "Yes");
      tooltip.addField("Array Type", this.typeWithoutArray);
    }

    if (this.distributionKeyNumber !== null) {
      tooltip.addField("Distribution Key Number", this.distributionKeyNumber.toString());
    } else {
      tooltip.addField("Distribution Key Number", "Not part of distribution key");
    }

    tooltip.addField("Generated", this.isGenerated ? "Yes" : "No");

    if (this.isMetadata && this.metadataKey) {
      tooltip.addField("Metadata Column", `Yes, maps to key: ${this.metadataKey}`);
    } else {
      tooltip.addField("Metadata Column", "No");
    }

    return tooltip;
  }

  /** Returns a single line representation of this column, for use within the containing relation's tooltip */
  tooltipLine(): string {
    const parts: string[] = [`${this.name}: ${formatSqlType(this.dataType)}`];
    if (!this.isNullable) {
      parts.push("NOT NULL");
    } else {
      parts.push("NULL");
    }
    if (this.distributionKeyNumber !== null) {
      parts.push(`DistKey#${this.distributionKeyNumber}`);
    }
    if (this.isGenerated) {
      parts.push("GENERATED");
    }
    if (this.isMetadata) {
      parts.push(`METADATA(${this.metadataKey})`);
    }
    return parts.join(" ");
  }
}

export class CompositeFlinkRelationColumn extends FlinkRelationColumn {
  /** Sub-columns for this ROW column */
  readonly columns: FlinkRelationColumn[];

  constructor(
    props: Pick<
      FlinkRelationColumn,
      | "relationName"
      | "name"
      | "dataType"
      | "fullDataType"
      | "isNullable"
      | "distributionKeyNumber"
      | "isGenerated"
      | "isPersisted"
      | "isHidden"
      | "metadataKey"
    > & {
      columns: FlinkRelationColumn[];
    },
  ) {
    super(props);
    this.columns = props.columns;
  }

  getTreeItem(): TreeItem {
    const item = super.getTreeItem();

    // I gots me some kids, so bring on the expandy arrow
    item.collapsibleState = TreeItemCollapsibleState.Collapsed;

    return item;
  }
}

export function relationColumnFactory(
  props: Pick<
    FlinkRelationColumn,
    | "relationName"
    | "name"
    | "dataType"
    | "fullDataType"
    | "isNullable"
    | "distributionKeyNumber"
    | "isGenerated"
    | "isPersisted"
    | "isHidden"
    | "metadataKey"
  >,
): FlinkRelationColumn {
  if (!props.fullDataType.startsWith("ROW<") && !props.fullDataType.startsWith("ARRAY<ROW<")) {
    return new FlinkRelationColumn(props);
  }

  let fullDataType = props.fullDataType;
  // Is this an array of rows?
  if (fullDataType.startsWith("ARRAY<")) {
    // Strip off leading "ARRAY<" and trailing ">" to get to the ROW<>
    fullDataType = fullDataType.substring(6, fullDataType.length - 1).trim();
  }

  // Parse sub-columns out of the fullDataType, which should be in the form:
  // ROW<`field1` TYPE1 [NOT] NULL, `field2` TYPE2 TYPE1 [NOT] NULL, ...>
  // Strip off the leading "ROW<" and trailing ">" first.
  const inner = fullDataType.substring(4, fullDataType.length - 1).trim();
  const columns: FlinkRelationColumn[] = [];

  let current = "";
  let angleBrackets = 0;
  let inBackticks = false;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === "<" && !inBackticks) {
      angleBrackets++;
    } else if (char === ">" && !inBackticks) {
      angleBrackets--;
    }

    if (char === "," && angleBrackets === 0 && !inBackticks) {
      // End of current column definition
      // Grab out the name, type, and nullability
      const { name, dataType, isNullable } = (() => {
        const parts = current.trim().split(/\s+/);
        if (parts.length < 2) {
          throw new Error(`Invalid column definition: ${current}`);
        }
        const colName = parts[0].replace(/`/g, ""); // remove backticks
        const typeParts = [];
        let isNullable = true;
        for (let j = 1; j < parts.length; j++) {
          const p = parts[j];
          if (p.toUpperCase() === "NOT") {
            if (j + 1 < parts.length && parts[j + 1].toUpperCase() === "NULL") {
              isNullable = false;
              j++; // skip next part as it's NULL
            }
          } else if (p.toUpperCase() === "NULL") {
            isNullable = true;
          } else {
            typeParts.push(p);
          }
        }
        return { name: colName, dataType: typeParts.join(" "), isNullable };
      })();

      const col = relationColumnFactory({
        relationName: `${props.relationName}.${props.name}`,
        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        fullDataType: dataType,
        name: name,
        dataType: dataType,
        isNullable: isNullable,
      });
      logger.info(
        `Parsed sub-column ${col.name} of type ${col.dataType} (nullable: ${col.isNullable})`,
      );
      columns.push(col);
      current = "";
    } else {
      current += char;
    }
  }

  return new CompositeFlinkRelationColumn({ ...props, columns });
}

/** Type of a Flink relation (table or view). */
export enum FlinkRelationType {
  BaseTable = "BASE_TABLE",
  View = "VIEW",
}

/**
 * Represents a Flink relation (base table or view) within the system catalog.
 * Immutable data holder with light convenience getters, mirroring the style of FlinkUdf and Column.
 */
export class FlinkRelation {
  /** Relation name */
  readonly name: string;
  /** Optional comment / description */
  readonly comment: string | null;
  /** Relation type (base table or view) */
  readonly type: FlinkRelationType;
  /** Number of distribution buckets if distributed */
  readonly distributionBucketCount: number;
  /** Whether the relation is physically distributed */
  readonly isDistributed: boolean;
  /** Whether a watermark is defined */
  readonly isWatermarked: boolean;
  /** Column the watermark is defined on (if any) */
  readonly watermarkColumn: string | null;
  /** Watermark expression (if any) */
  readonly watermarkExpression: string | null;
  /** Whether the watermark column is hidden */
  readonly watermarkColumnIsHidden: boolean;
  /** Columns of the relation */
  columns: FlinkRelationColumn[];

  constructor(
    props: Pick<
      FlinkRelation,
      | "name"
      | "comment"
      | "type"
      | "distributionBucketCount"
      | "isDistributed"
      | "isWatermarked"
      | "watermarkColumn"
      | "watermarkExpression"
      | "watermarkColumnIsHidden"
      | "columns"
    >,
  ) {
    this.name = props.name;
    this.comment = props.comment;
    this.type = props.type;
    this.distributionBucketCount = props.distributionBucketCount;
    this.isDistributed = props.isDistributed;
    this.isWatermarked = props.isWatermarked;
    this.watermarkColumn = props.watermarkColumn;
    this.watermarkExpression = props.watermarkExpression;
    this.watermarkColumnIsHidden = props.watermarkColumnIsHidden;
    this.columns = props.columns;
  }

  get id(): string {
    return this.name;
  }

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  /** Returns the visible (non-hidden) columns. */
  get visibleColumns(): FlinkRelationColumn[] {
    return this.columns.filter((c) => !c.isHidden);
  }

  get isView(): boolean {
    return this.type === FlinkRelationType.View;
  }

  searchableText(): string {
    const parts = [];

    parts.push(this.name);
    if (this.comment) {
      parts.push(this.comment);
    }
    for (const col of this.columns) {
      parts.push(col.name);
      parts.push(col.dataType);
      if (col.metadataKey) {
        parts.push(col.metadataKey);
      }
    }

    return parts.join(" ");
  }

  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name, TreeItemCollapsibleState.Collapsed);
    item.iconPath = new ThemeIcon(IconNames.FLINK_FUNCTION); // TODO replace with table/view specific icons when available
    item.id = this.name;
    item.contextValue = `ccloud-flink-relation-${this.isView ? "view" : "table"}`;
    item.tooltip = this.getToolTip();
    return item;
  }

  /**
   * Builds a rich markdown tooltip describing this relation (table or view).
   * Includes structural, distribution, watermark, and column metadata in a concise format.
   */
  getToolTip(): CustomMarkdownString {
    // Choose icon + title based on relation type (fall back to function icon if specific ones are unavailable)
    // IconNames.FLINK_TABLE / IconNames.FLINK_VIEW are expected to exist alongside FLINK_FUNCTION.
    const headerIcon: IconNames = IconNames.FLINK_FUNCTION; // TODO replace with table/view specific icons when available
    const headerTitle = this.isView ? "Flink View" : "Flink Table";

    const tooltip = new CustomMarkdownString().addHeader(headerTitle, headerIcon);

    tooltip.addField("Name", this.name);

    if (this.comment) {
      tooltip.addField("Comment", this.comment);
    }

    // Distribution
    if (this.isDistributed) {
      tooltip.addField(
        "Distribution",
        `${this.distributionBucketCount} bucket${this.distributionBucketCount === 1 ? "" : "s"}`,
      );
    } else {
      tooltip.addField("Distribution", "Not distributed");
    }

    // Watermark
    if (this.isWatermarked) {
      const wmParts: string[] = [];
      if (this.watermarkColumn) {
        wmParts.push(
          `Column: ${this.watermarkColumn}${this.watermarkColumnIsHidden ? " (hidden)" : ""}`,
        );
      }
      if (this.watermarkExpression) {
        wmParts.push(`Expression: ${this.watermarkExpression}`);
      }
      tooltip.addField("Watermark", wmParts.join("\n"));
    } else {
      tooltip.addField("Watermark", "None");
    }

    // List visible columns
    const visible = this.visibleColumns;
    if (visible.length === 0) {
      tooltip.addField("Visible Columns", "None");
    } else {
      const rendered = visible.map((c) => c.tooltipLine());
      tooltip.addField("Visible Columns", rendered.join("\n"));
    }

    return tooltip;
  }
}

export class FlinkUdfTreeItem extends TreeItem {
  resource: FlinkUdf;

  constructor(resource: FlinkUdf) {
    super(resource.name, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon(resource.iconName);
    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-udf`;

    this.description = `${resource.parametersSignature} → ${formatSqlType(resource.returnType)}`;
    this.tooltip = createFlinkUdfToolTip(resource);
  }
}

export function createFlinkUdfToolTip(resource: FlinkUdf): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Flink UDF", IconNames.FLINK_FUNCTION)
    .addField("ID", resource.id)
    .addField("Description", resource.description)
    .addField("Return Type", formatSqlType(resource.returnType));

  if (resource.parameters.length > 0) {
    tooltip.addField("Parameters", `${resource.parametersSignature}`);
  } else {
    tooltip.addField("Parameters", "None");
  }

  // Additional function properties
  tooltip.addField("Language", resource.language);
  tooltip.addField("External Name", resource.externalName);
  tooltip.addField("Deterministic", resource.isDeterministic ? "Yes" : "No");
  tooltip.addField("Kind", resource.kind ?? "UNKNOWN");
  tooltip.addField(
    "Created At",
    resource.creationTs.toLocaleString(undefined, { timeZoneName: "short" }),
  );
  tooltip.addField("Artifact Reference", resource.artifactReferenceExtracted);
  return tooltip;
}

/**
 * Returns a display-friendly version of the data type by removing max-int size specifications and escaping backticks.
 */
export function formatSqlType(sqlType: string): string {
  // Remove noisy (2GBs) max size type values
  const cleaned = sqlType.replace(/\(2147483647\)/g, "");
  // Remove backticks that are part of SQL syntax (e.g., in ROW<`field` VARCHAR>)
  return cleaned.replace(/`/g, "");
}
