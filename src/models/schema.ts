import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { ContainerTreeItem, CustomMarkdownString } from "./main";

export enum SchemaType {
  Avro = "AVRO",
  Json = "JSON",
  Protobuf = "PROTOBUF",
}

// Main class representing CCloud Schema Registry schemas, matching key/value pairs returned
// by the `confluent schema-registry schema list` command.
export class Schema extends Data {
  // TODO: this will need to be updated once we split this class into LocalSchema and CCloudSchema
  readonly connectionId = CCLOUD_CONNECTION_ID;

  id!: Enforced<string>;
  subject!: Enforced<string>;
  version!: Enforced<number>;
  type!: SchemaType;
  // added separately from the response data, used for follow-on API calls
  schemaRegistryId!: Enforced<string>;
  environmentId!: Enforced<string>;

  /** Returns true if this schema subject corresponds to the topic name per TopicNameStrategy */
  matchesTopicName(topicName: string): boolean {
    // strip off the -key/-value suffixes to match the topic name exactly based on TopicNameStrategy
    // since we can't use `startsWith` due to the potential for multiple topics with the same prefix
    const suffixlessSubject = this.subject.replace(/-key$|-value$/, "");
    return suffixlessSubject === topicName;
  }

  fileExtension(): string {
    const extensionMap: { [key in SchemaType]: string } = {
      [SchemaType.Avro]: "avsc",
      [SchemaType.Json]: "json",
      [SchemaType.Protobuf]: "proto",
    };
    return extensionMap[this.type];
  }

  fileName(): string {
    return `${this.subject}.${this.id}.v${this.version}.confluent.${this.fileExtension()}`;
  }

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas/${this.subject}`;
  }
}

// Tree item representing a CCloud Schema Registry schema
// TODO: SIDECAR UPDATE
export class SchemaTreeItem extends vscode.TreeItem {
  resource: Schema;

  constructor(resource: Schema) {
    const label = resource.id.toString();
    super(label, vscode.TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    this.contextValue = "ccloud-schema";

    // user-facing properties
    this.description = `v${resource.version}`;
    this.iconPath = new vscode.ThemeIcon(IconNames.SCHEMA);
    this.tooltip = createSchemaTooltip(this.resource);
  }
}

function createSchemaTooltip(resource: Schema): vscode.MarkdownString {
  // TODO(shoup) update for local SR once available
  const tooltip = new CustomMarkdownString()
    .appendMarkdown("#### $(primitive-square) Schema")
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(`ID: \`${resource.id}\`\n\n`)
    .appendMarkdown(`Subject: \`${resource.subject}\`\n\n`)
    .appendMarkdown(`Version: \`${resource.version}\`\n\n`)
    .appendMarkdown(`Type: \`${resource.type}\``)
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(
      `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${resource.ccloudUrl})`,
    );
  return tooltip;
}

export enum SchemaKind {
  Key = "key",
  Value = "value",
}

/**
 * Groups {@link Schema}s by subject and sorts versions in descending order.
 * @param schemas List of schemas to group
 * @param topicName Optional topic name to filter schema subjects by
 * @remarks The resulting groups should be structured like:
 * ```
 *  - subject1
 *  -- version2
 *  -- version1
 *  - subject2
 *  -- version1
 *  ...etc
 * ```
 */
export function generateSchemaSubjectGroups(
  schemas: Schema[],
  topicName?: string,
): ContainerTreeItem<Schema>[] {
  const schemaGroups: ContainerTreeItem<Schema>[] = [];
  if (schemas.length === 0) {
    return schemaGroups;
  }

  if (topicName) {
    schemas = schemas.filter((schema) => schema.matchesTopicName(topicName));
  }

  // create a map of schema subjects to their respective schemas
  const schemaSubjectGroups: Map<string, Schema[]> = new Map();
  for (const schema of schemas) {
    const subject = schema.subject;
    if (!schemaSubjectGroups.has(subject)) {
      schemaSubjectGroups.set(subject, []);
    }
    schemaSubjectGroups.get(subject)?.push(schema);
  }
  // convert the map to an array of ContainerTreeItems
  for (const [subject, schemaGroup] of schemaSubjectGroups) {
    // sort in version-descending order so the latest version is always at the top
    schemaGroup.sort((a, b) => b.version - a.version);
    // get string of unique schema types for the group
    const schemaTypes = Array.from(new Set(schemaGroup.map((schema) => schema.type))).join(", ");
    const schemaContainerItem = new ContainerTreeItem<Schema>(
      subject,
      vscode.TreeItemCollapsibleState.Collapsed,
      schemaGroup,
    );
    // set the icon based on subject suffix
    if (subject.endsWith("-key")) {
      schemaContainerItem.iconPath = new vscode.ThemeIcon(IconNames.KEY_SUBJECT);
    } else if (subject.endsWith("-value")) {
      schemaContainerItem.iconPath = new vscode.ThemeIcon(IconNames.VALUE_SUBJECT);
    } else {
      schemaContainerItem.iconPath = new vscode.ThemeIcon(IconNames.OTHER_SUBJECT);
    }
    // override description to show schema types + count
    schemaContainerItem.description = `${schemaTypes} (${schemaGroup.length})`;
    schemaGroups.push(schemaContainerItem);
  }
  return schemaGroups;
}
