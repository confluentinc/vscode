import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import { ContainerTreeItem, CustomMarkdownString } from "./main";
import { ConnectionId, IResourceBase, isCCloud } from "./resource";

export enum SchemaType {
  Avro = "AVRO",
  Json = "JSON",
  Protobuf = "PROTOBUF",
}

const extensionMap: { [key in SchemaType]: string } = {
  [SchemaType.Avro]: "avsc",
  [SchemaType.Json]: "json",
  [SchemaType.Protobuf]: "proto",
};

// Main class representing CCloud Schema Registry schemas, matching key/value pairs returned
// by the `confluent schema-registry schema list` command.
export class Schema extends Data implements IResourceBase {
  connectionId!: Enforced<ConnectionId>;
  connectionType!: Enforced<ConnectionType>;
  iconName: IconNames.SCHEMA = IconNames.SCHEMA;

  id!: Enforced<string>;
  subject!: Enforced<string>;
  version!: Enforced<number>;
  type!: SchemaType;
  // added separately from the response data, used for follow-on API calls
  schemaRegistryId!: Enforced<string>;
  environmentId!: Enforced<string> | undefined;

  /** Returns true if this schema subject corresponds to the topic name per TopicNameStrategy or TopicRecordNameStrategy*/
  matchesTopicName(topicName: string): boolean {
    if (this.subject.endsWith("-key")) {
      // TopicNameStrategy key schema
      return this.subject === `${topicName}-key`;
    } else if (this.subject.endsWith("-value")) {
      // TopicNameStrategy value schema
      return this.subject === `${topicName}-value`;
    } else {
      // only other possibility is a matching TopicRecordNameStrategy (value) schema
      return this.subject.startsWith(`${topicName}-`);
    }
  }

  fileExtension(): string {
    return extensionMap[this.type];
  }

  fileName(): string {
    return `${this.subject}.${this.id}.v${this.version}.confluent.${this.fileExtension()}`;
  }

  get ccloudUrl(): string {
    if (isCCloud(this)) {
      return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas/${this.subject}`;
    }
    return "";
  }
}

// Tree item representing a CCloud Schema Registry schema
export class SchemaTreeItem extends vscode.TreeItem {
  resource: Schema;

  constructor(resource: Schema) {
    const label = `v${resource.version}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.id = `${resource.id}-${resource.subject}-${resource.version}`;
    // internal properties
    this.resource = resource;
    // the only real purpose of the connectionType prefix is to allow CCloud schemas to get the
    // "View in CCloud" context menu item
    this.contextValue = `${this.resource.connectionType.toLowerCase()}-schema`;

    // user-facing properties
    this.description = resource.id.toString();
    this.iconPath = new vscode.ThemeIcon(IconNames.SCHEMA);
    this.tooltip = createSchemaTooltip(this.resource);
  }
}

function createSchemaTooltip(resource: Schema): vscode.MarkdownString {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${resource.iconName}) Schema`)
    .appendMarkdown("\n\n---")
    .appendMarkdown(`\n\nID: \`${resource.id}\``)
    .appendMarkdown(`\n\nSubject: \`${resource.subject}\``)
    .appendMarkdown(`\n\nVersion: \`${resource.version}\``)
    .appendMarkdown(`\n\nType: \`${resource.type}\``);
  if (isCCloud(resource)) {
    tooltip
      .appendMarkdown("\n\n---")
      .appendMarkdown(
        `\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${resource.ccloudUrl})`,
      );
  }
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
    schemaContainerItem.iconPath = getSubjectIcon(subject, topicName !== undefined);

    // override description to show schema types + count
    schemaContainerItem.description = `${schemaTypes} (${schemaGroup.length})`;
    if (schemaGroup.length > 1) {
      // set context key indicating this group has multiple versions (so can be quickly diff'd, etc.)
      schemaContainerItem.contextValue = "multiple-versions";
    }
    schemaGroups.push(schemaContainerItem);
  }
  return schemaGroups;
}

/** Determine an icon for a schema subject,
 *  possibly considering erring on VALUE_SUBJECT over OTHER_SUBJECT
 */
export function getSubjectIcon(subject: string, errOnValueSubject?: boolean): vscode.ThemeIcon {
  if (subject.endsWith("-key")) {
    return new vscode.ThemeIcon(IconNames.KEY_SUBJECT);
  } else if (subject.endsWith("-value") || errOnValueSubject) {
    // value schema or topic record name strategy (the errOnValueSubject flag is used
    // when generating schema groups for a topic, where
    // if this schema is in the running and not a key schema, it should be considered
    // a value schema (TopicRecordNameStrategy).)
    return new vscode.ThemeIcon(IconNames.VALUE_SUBJECT);
  } else {
    return new vscode.ThemeIcon(IconNames.OTHER_SUBJECT);
  }
}
