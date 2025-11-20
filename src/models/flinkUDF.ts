import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { formatSqlType } from "../utils/flinkTypes";
 
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

/** Class representing a parameter for a Flink UDF. */
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

/**
 * Represents a Flink UDF.
 */
export class FlinkUdf implements IResourceBase, ISearchable {
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

/** TreeItem subclass for FlinkUdf */
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

/**
 * Creates a rich markdown tooltip describing the given Flink UDF.
 * @param resource The Flink UDF to create a tooltip for.
 * @returns CustomMarkdownString for the tooltip for the UDF.
 */
export function createFlinkUdfToolTip(resource: FlinkUdf): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Flink UDF", IconNames.FLINK_FUNCTION)
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
