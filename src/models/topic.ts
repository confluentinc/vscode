import * as vscode from "vscode";
import { KAFKA_TOPIC_OPERATIONS } from "../authz/constants";
import type { KafkaTopicOperation } from "../authz/types";
import type { ConnectionType } from "../connections";
import { CCLOUD_BASE_PATH, UTM_SOURCE_VSCODE } from "../constants";
import { IconNames } from "../icons";
import type { IdItem } from "./main";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";
import { isCCloud } from "./resource";
import type { Subject } from "./schema";

/** Main class representing Kafka topic */
export class KafkaTopic implements IResourceBase, ISearchable, IdItem {
  connectionId: ConnectionId;
  connectionType: ConnectionType;

  name: string;
  replication_factor: number;
  partition_count: number;
  partitions: object;
  configs: object;
  /** Is this a topic internal to the cluster's operation
   * ("__consumer_offsets", "__transaction_state", etc.)
   * Most likely false.
   */
  is_internal: boolean;

  clusterId: string;
  // CCloud env IDs are unique, direct/local env IDs match their connection IDs
  environmentId: EnvironmentId;
  /** Belongs to a Flink-supporting CCloud Kafka cluster? */
  isFlinkable: boolean = false;

  /** Schema subjects; only used with Topics view search. */
  children: Subject[] = [];

  /** Whether the topic has associated schema subjects. */
  get hasSchema(): boolean {
    return this.children.length > 0;
  }

  get iconName(): IconNames {
    return this.hasSchema ? IconNames.TOPIC : IconNames.TOPIC_WITHOUT_SCHEMA;
  }

  /** Operations the user is authzd to perform on the topic */
  operations: KafkaTopicOperation[] = [];

  constructor(
    props: Pick<
      KafkaTopic,
      | "connectionId"
      | "connectionType"
      | "environmentId"
      | "clusterId"
      | "name"
      | "replication_factor"
      | "partition_count"
      | "partitions"
      | "configs"
      | "is_internal"
      | "operations"
      | "isFlinkable"
      | "children"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.clusterId = props.clusterId;

    this.name = props.name;
    this.replication_factor = props.replication_factor;
    this.partition_count = props.partition_count;
    this.partitions = props.partitions;
    this.configs = props.configs;
    this.is_internal = props.is_internal;

    this.operations = props.operations ?? [];
    this.isFlinkable = props.isFlinkable ?? false;
    this.children = props.children ?? [];
  }

  /** Property producing a URL for the topic in the Confluent Cloud UI */
  get ccloudUrl(): string {
    // Only CCloud topics have a ccloud URL.
    if (isCCloud(this)) {
      return `https://${CCLOUD_BASE_PATH}/environments/${this.environmentId}/clusters/${this.clusterId}/topics/${this.name}/overview?utm_source=${UTM_SOURCE_VSCODE}`;
    }
    return "";
  }

  /** Property producing a unique identifier for a topic based on both the cluster id and the topic name */
  get id(): string {
    return `${this.clusterId}-${this.name}`;
  }

  searchableText(): string {
    return this.name;
  }
}

// Main class controlling the representation of a Kafka topic as a tree item.
export class KafkaTopicTreeItem extends vscode.TreeItem {
  resource: KafkaTopic;

  constructor(resource: KafkaTopic) {
    super(resource.name);

    // internal properties
    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${this.resource.connectionType.toLowerCase()}-kafka-topic`;
    if (this.resource.hasSchema) {
      this.contextValue += "-with-schema";
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    // Check if the topic is flinkable and append the flag
    if (this.resource.isFlinkable) {
      this.contextValue += "-flinkable";
    }

    // user-facing properties
    // this.description = "";  // TBD
    this.iconPath = new vscode.ThemeIcon(
      this.resource.iconName,
      // only set a color if there is no associated subject/schema
      resource.hasSchema ? undefined : new vscode.ThemeColor("problemsWarningIcon.foreground"),
    );

    const missingAuthz: KafkaTopicOperation[] = this.checkMissingAuthorizedOperations(resource);
    this.tooltip = createKafkaTopicTooltip(this.resource, missingAuthz);
  }

  checkMissingAuthorizedOperations(resource: KafkaTopic): KafkaTopicOperation[] {
    for (const op of KAFKA_TOPIC_OPERATIONS) {
      if (resource.operations.includes(op)) {
        // append to contextValue for each authorized operation
        // e.g. "local-kafka-topic-authzREAD-authzWRITE"
        this.contextValue += `-authz${op}`;
      }
    }
    return KAFKA_TOPIC_OPERATIONS.filter((op) => !resource.operations.includes(op));
  }
}

function createKafkaTopicTooltip(
  resource: KafkaTopic,
  missingAuthz: KafkaTopicOperation[],
): CustomMarkdownString {
  const iconName = resource.hasSchema ? IconNames.TOPIC : IconNames.TOPIC_WITHOUT_SCHEMA;

  const tooltip = new CustomMarkdownString()
    .addHeader("Kafka Topic", iconName)
    .addField("Name", resource.name)
    .addField("Replication Factor", resource.replication_factor.toString())
    .addField("Partition Count", resource.partition_count.toString())
    .addField("Internal", resource.is_internal.toString());

  if (!resource.hasSchema) {
    tooltip.addWarning("No schema(s) found for topic.");
  }

  // list any missing authorized operations
  if (missingAuthz.length > 0) {
    tooltip.addWarning("Missing authorization for the following actions:");
    missingAuthz.forEach((op) => tooltip.appendMarkdown(` - ${op}\n`));
  }

  if (isCCloud(resource)) {
    tooltip.addCCloudLink(resource.ccloudUrl);
  }

  return tooltip;
}
