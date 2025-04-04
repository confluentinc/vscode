import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames, UTM_SOURCE_VSCODE } from "../constants";
import { CustomMarkdownString } from "./main";
import {
  ConnectionId,
  connectionIdToType,
  EnvironmentId,
  IResourceBase,
  isCCloud,
  ISchemaRegistryResource,
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
export class Subject implements IResourceBase, ISearchable, ISchemaRegistryResource {
  name!: string;

  connectionId!: ConnectionId;
  environmentId!: EnvironmentId;
  /** The id of the schema registry the subject was fetched from */
  schemaRegistryId!: string;

  /** Unique conglomeration of the connection id, SR id, and the subject name. */
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
    // These may be constructed from either route responses or resource manager cache load,
    // (i.e. outside of typescript's control), so be extra cautious.
    if (name === undefined || name === null || name === "") {
      throw new Error(
        `Subject name cannot be undefined, null, or empty: ${name} from ${connectionId}`,
      );
    }

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

  get ccloudUrl(): string {
    if (isCCloud(this)) {
      return `https://confluent.cloud/environments/${this.environmentId}/stream-governance/schema-registry/data-contracts/${this.name}?utm_source=${UTM_SOURCE_VSCODE}`;
    }
    return "";
  }

  searchableText(): string {
    return this.name;
  }

  /**
   * Merge the given schema array into ours, if any, ala mergesort:
   * If we have NO schemas array currently, retain the provided array.
   *
   * If we have a schemas array, then retain any member that is present in the given array,
   * as well as potentially add newly provided members.
   */
  mergeSchemas(newSchemas: Schema[]) {
    // If we had no schemas previously, then graciously accept the new ones.
    if (!this.schemas) {
      this.schemas = newSchemas;
      return;
    }

    // Iterate over both arrays in parallel. Both arrays are sorted by schema.version descending, so we can
    // use a merge sort approach to combine them.
    // 1. If a schema is present in both existing and new arrays, keep it in updated existing (merged).
    // 2. If a schema is present in new array, but missing from existing, add it to merged.
    // 3. If the schema is present in existing, but missing from new array, then skip it (do not add to merged).

    const merged: Schema[] = [];
    let i = 0,
      j = 0;

    while (i < this.schemas.length || j < newSchemas.length) {
      // If we've exhausted new schemas, we're done (don't keep schemas not in new array)
      if (j >= newSchemas.length) {
        break;
      }

      const ourSchema = this.schemas[i];
      const newSchema = newSchemas[j];

      // Compare versions to determine ordering
      if (ourSchema.version > newSchema.version) {
        // Keep our higher version schema only if it exists in new schemas
        // (We'll encounter it later in the new schemas if it should be kept)
        i++;
      } else if (ourSchema.version < newSchema.version) {
        // Add the new schema which we don't have
        merged.push(newSchema);
        j++;
      } else {
        // Same version - prefer the existing schema (because view controllers compare by object identity) and advance both indices
        merged.push(ourSchema);
        i++;
        j++;
      }
    }

    this.schemas = merged;
  }
}

/**
 * A Subject subclass that guarantees schemas will be available as a non-null array.
 * This is useful for cases where we know schemas will always be present.
 */
export class SubjectWithSchemas extends Subject {
  declare schemas: Schema[];

  constructor(
    name: string,
    connectionId: ConnectionId,
    environmentId: EnvironmentId,
    schemaRegistryId: string,
    schemas: Schema[],
  ) {
    if (!schemas || schemas.length === 0) {
      throw new Error("SubjectWithSchemas requires a non-empty schemas array");
    }

    super(name, connectionId, environmentId, schemaRegistryId, schemas);
  }
}

/** Base class representing a single version of a schema. */
export class Schema extends Data implements IResourceBase {
  connectionId!: Enforced<ConnectionId>;
  connectionType!: Enforced<ConnectionType>;

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
      return `https://confluent.cloud/environments/${this.environmentId}/stream-governance/schema-registry/data-contracts/${this.subject}?utm_source=${UTM_SOURCE_VSCODE}`;
    }
    return "";
  }

  /** Produce a schema-version-free Subject instance from this Schema. Property .schemas will be null.*/
  subjectObject(): Subject {
    if (!this.environmentId) {
      throw new Error("Schema missing environmentId, unable to create Subject object.");
    }
    return new Subject(this.subject, this.connectionId, this.environmentId, this.schemaRegistryId);
  }

  /** Promote to a Subject object carrying the provided schema versions, which should include this. */
  subjectWithSchemasObject(schemas: Schema[]): SubjectWithSchemas {
    if (!this.environmentId) {
      throw new Error("Schema missing environmentId, unable to create Subject object.");
    }

    return new SubjectWithSchemas(
      this.subject,
      this.connectionId,
      this.environmentId,
      this.schemaRegistryId,
      schemas,
    );
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

    this.iconPath = getSubjectIcon(subject.name);

    const propertyParts: string[] = new Array<string>();

    propertyParts.push(subject.connectionType.toLowerCase());

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
    .appendMarkdown("#### Schema")
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
