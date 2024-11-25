import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { ContainerTreeItem, CustomMarkdownString } from "./main";

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

const languageTypes: { [key in SchemaType]: string[] } = {
  [SchemaType.Avro]: ["avroavsc", "json"],
  [SchemaType.Json]: ["json"],
  [SchemaType.Protobuf]: ["proto"],
};

// Main class representing CCloud Schema Registry schemas, matching key/value pairs returned
// by the `confluent schema-registry schema list` command.
export class Schema extends Data {
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

  /** Get the proper file extension */
  fileExtension(): string {
    return extensionMap[this.type];
  }

  /**
   * Get possible language types for this kind of extension in priority order.
   * Used to try to rendezvous on a language type that the user might have installed.
   */
  languageTypes(): string[] {
    return languageTypes[this.type];
  }

  fileName(): string {
    return `${this.subject}.${this.id}.v${this.version}.confluent.${this.fileExtension()}`;
  }

  get ccloudUrl(): string {
    if (this.isLocalSchema()) {
      return "";
    }
    return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas/${this.subject}`;
  }

  isLocalSchema(): boolean {
    return this.environmentId == null;
  }

  /** Is this a CCloud-resident schema, as opposed to local or perhaps direct-connection? */
  isCCloudSchema(): boolean {
    return this.environmentId != null;
  }

  get connectionId(): string {
    return this.isLocalSchema() ? LOCAL_CONNECTION_ID : CCLOUD_CONNECTION_ID;
  }
}

// Tree item representing a Schema Registry schema
export class SchemaTreeItem extends vscode.TreeItem {
  resource: Schema;

  constructor(resource: Schema) {
    const label = `v${resource.version}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.id = `${resource.id}-${resource.subject}-${resource.version}`;
    // internal properties
    this.resource = resource;
    this.contextValue = resource.isCCloudSchema() ? "ccloud-schema" : "local-schema";

    // user-facing properties
    this.description = resource.id.toString();
    this.iconPath = new vscode.ThemeIcon(IconNames.SCHEMA);
    this.tooltip = createSchemaTooltip(this.resource);
  }
}

function createSchemaTooltip(resource: Schema): vscode.MarkdownString {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown("#### $(primitive-square) Schema")
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(`ID: \`${resource.id}\`\n\n`)
    .appendMarkdown(`Subject: \`${resource.subject}\`\n\n`)
    .appendMarkdown(`Version: \`${resource.version}\`\n\n`)
    .appendMarkdown(`Type: \`${resource.type}\``);
  if (!resource.isLocalSchema()) {
    tooltip
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(
        `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${resource.ccloudUrl})`,
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
