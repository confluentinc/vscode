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

const languageTypes: { [key in SchemaType]: string[] } = {
  [SchemaType.Avro]: ["avroavsc", "json"],
  [SchemaType.Json]: ["json"],
  [SchemaType.Protobuf]: ["proto3", "proto"],
};

export function getLanguageTypes(schemaType: SchemaType): string[] {
  return languageTypes[schemaType];
}

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

  /** Is this the highest version bound to this subject? */
  isHighestVersion!: Enforced<boolean>;

  /** Returns true if this schema subject corresponds to the topic name per TopicNameStrategy or TopicRecordNameStrategy*/
  matchesTopicName(topicName: string): boolean {
    return subjectMatchesTopicName(this.subject, topicName);
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
    return getLanguageTypes(this.type);
  }

  /**
   * Return a file name for this schema.
   */
  fileName(): string {
    return `${this.subject}.${this.id}.v${this.version}.confluent.${this.fileExtension()}`;
  }

  /**
   * Return a file name for a draft next version of this schema.
   */
  nextVersionDraftFileName(draftNumber: number): string {
    if (draftNumber === 0) {
      return `${this.subject}.v${this.version + 1}-draft.confluent.${this.fileExtension()}`;
    } else {
      return `${this.subject}.v${this.version + 1}-draft-${draftNumber}.confluent.${this.fileExtension()}`;
    }
  }

  get ccloudUrl(): string {
    if (isCCloud(this)) {
      return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas/${this.subject}`;
    }
    return "";
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
    // the only real purpose of the connectionType prefix is to allow CCloud schemas to get the
    // "View in CCloud" context menu item
    const connectionType = resource.connectionType.toLowerCase();
    this.contextValue = resource.isHighestVersion
      ? `${connectionType}-evolvable-schema`
      : `${connectionType}-schema`;

    // user-facing properties
    this.description = resource.id.toString();
    this.iconPath = new vscode.ThemeIcon(IconNames.SCHEMA);
    this.tooltip = createSchemaTooltip(this.resource);

    this.command = {
      command: "confluent.schemaViewer.viewLocally",
      title: "View Schema",
      arguments: [this.resource],
    };
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

    const contextValueParts: string[] = [];

    // override description to show schema types + count
    schemaContainerItem.description = `${schemaTypes} (${schemaGroup.length})`;
    if (schemaGroup.length > 1) {
      // set context key indicating this group has multiple versions (so can be quickly diff'd, etc.)
      contextValueParts.push("multiple-versions");
    }

    // set context value identifying this as a schema group
    contextValueParts.push("schema-subject");

    // dash-join all parts, assign to context value
    schemaContainerItem.contextValue = contextValueParts.join("-");

    schemaGroups.push(schemaContainerItem);
  }

  // sort multiple groups by subject
  if (schemaGroups.length > 1) {
    schemaGroups.sort((a, b) => {
      // compare as strings, not TreeItemLabels
      const labelA = a.label! as string;
      const labelB = b.label! as string;
      return labelA.localeCompare(labelB);
    });
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

/**
 * Determine if the schema subject and a topic name seem correlated
 * based on either TopicNameStrategy or TopicRecordNameStrategy.
 */
export function subjectMatchesTopicName(subject: string, topicName: string): boolean {
  if (subject.endsWith("-key")) {
    // TopicNameStrategy key schema
    return subject === `${topicName}-key`;
  } else if (subject.endsWith("-value")) {
    // TopicNameStrategy value schema
    return subject === `${topicName}-value`;
  } else {
    // only other possibility is a matching TopicRecordNameStrategy (value) schema
    return subject.startsWith(`${topicName}-`);
  }
}
