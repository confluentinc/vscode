import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import { CustomMarkdownString } from "./main";
import {
  ConnectionId,
  connectionIdToType,
  EnvironmentId,
  IResourceBase,
  isCCloud,
  ISearchable,
} from "./resource";

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

/**
 * Thin ISearchable wrapper around a schema subject string. Needs to carry the metadata
 * from its source schema registry with it for later API calls.
 *
 * Depending on the constructor path, may also carry an array of Schema instances.
 */
export class Subject implements IResourceBase, ISearchable {
  name!: string;

  connectionId!: ConnectionId;
  environmentId!: EnvironmentId;
  schemaRegistryId!: string;

  id!: string;

  /** Will be not-null only when topics view controller's getChildren() called on a topic. */
  schemas: Schema[] | null;

  constructor(
    name: string,
    connectionId: ConnectionId,
    environmentId: EnvironmentId,
    schemaRegistryId: string,
    schemas: Schema[] | null = null,
  ) {
    this.name = name;

    this.connectionId = connectionId;
    this.schemaRegistryId = schemaRegistryId;
    this.environmentId = environmentId;

    this.id = `${this.connectionId}-${this.schemaRegistryId}-${this.name}`;

    if (schemas && schemas.length === 0) {
      throw new Error(
        "Subject created with empty schema array. Should either be null or non-empty.",
      );
    }

    this.schemas = schemas;
  }

  get connectionType(): ConnectionType {
    return connectionIdToType(this.connectionId);
  }

  searchableText(): string {
    return this.name;
  }
}

/**
 *
 */
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
  environmentId!: EnvironmentId | undefined;

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
      return `https://confluent.cloud/environments/${this.environmentId}/stream-governance/schema-registry/data-contracts/${this.subject}`;
    }
    return "";
  }

  /** Produce a Subject instance from this Schema.*/
  subjectObject(): Subject {
    if (!this.environmentId) {
      throw new Error("Schema missing environmentId, unable to create Subject object.");
    }
    return new Subject(this.subject, this.connectionId, this.environmentId, this.schemaRegistryId);
  }

  searchableText(): string {
    // NOTE: based on the availability of schema-specific data at the time of SchemasViewProvider
    // loading, the Subject containers won't actually have any Schema children, so we can't offer
    // any searchability on them.
    return "";
  }
}

/**
 * Tree item representing a (single) subject, either with or without knowledge
 * of the schema bindings it contains.
 */
export class SubjectTreeItem extends vscode.TreeItem {
  constructor(subject: Subject) {
    super(subject.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.id = subject.name;

    // If we have schema bindings, then err on the side of showing the value icon
    const errOnValueSubject: boolean = subject.schemas != null;
    this.iconPath = getSubjectIcon(subject.name, errOnValueSubject);

    const propertyParts: string[] = new Array<string>();
    if (subject.schemas) {
      this.description = `${subject.schemas[0].type} (${subject.schemas.length})`;
      if (subject.schemas.length > 1) {
        propertyParts.push("multiple-versions");
      }
    }
    propertyParts.push("schema-subject");
    this.contextValue = propertyParts.join("-");
  }
}

/** Tree item representing a Schema Registry schema */
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

/** Determine an icon for a schema subject,
 *  possibly considering erring on VALUE_SUBJECT over OTHER_SUBJECT
 */
export function getSubjectIcon(subject: string, defaultToValueSubject?: boolean): vscode.ThemeIcon {
  if (subject.endsWith("-key")) {
    return new vscode.ThemeIcon(IconNames.KEY_SUBJECT);
  } else if (subject.endsWith("-value") || defaultToValueSubject) {
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
