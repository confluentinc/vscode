import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { KafkaTopicOperation } from "../authz/types";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import { CustomMarkdownString } from "./main";
import { ConnectionId, IResourceBase, isCCloud } from "./resource";

/** Main class representing Kafka topic */
export class KafkaTopic extends Data implements IResourceBase {
  connectionId!: Enforced<ConnectionId>;
  connectionType!: Enforced<ConnectionType>;
  iconName!: IconNames; // set depending on presence of associated schema(s)

  name!: Enforced<string>;
  replication_factor!: Enforced<number>;
  partition_count!: Enforced<number>;
  partitions!: Enforced<object>;
  configs!: Enforced<object>;
  /** Is this a topic internal to the cluster's operation
   * ("__consumer_offsets", "__transaction_state", etc.)
   * Most likely false.
   */
  is_internal!: Enforced<boolean>;

  clusterId!: Enforced<string>;
  // CCloud env IDs are unique, direct/local env IDs match their connection IDs
  environmentId!: string;
  hasSchema: boolean = false;

  /** Operations the user is authzd to perform on the topic */
  operations!: Enforced<KafkaTopicOperation[]>;

  /** Property producing a URL for the topic in the Confluent Cloud UI */
  get ccloudUrl(): string {
    // Only CCloud topics have a ccloud URL.
    if (isCCloud(this)) {
      return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.clusterId}/topics/${this.name}/overview`;
    }
    return "";
  }

  /** Property producing a unique identifier for a topic based on both the cluster id and the topic name */
  get uniqueId(): string {
    return `${this.clusterId}-${this.name}`;
  }
}

// Main class controlling the representation of a Kafka topic as a tree item.
export class KafkaTopicTreeItem extends vscode.TreeItem {
  resource: KafkaTopic;

  constructor(resource: KafkaTopic) {
    super(resource.name);

    // internal properties
    this.resource = resource;
    this.contextValue = `${this.resource.connectionType.toLowerCase()}-kafka-topic`;
    if (this.resource.hasSchema) {
      this.contextValue += "-with-schema";
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    // user-facing properties
    // this.description = "";  // TBD
    this.iconPath = resource.hasSchema
      ? new vscode.ThemeIcon(IconNames.TOPIC)
      : new vscode.ThemeIcon(
          IconNames.TOPIC_WITHOUT_SCHEMA,
          new vscode.ThemeColor("problemsWarningIcon.foreground"),
        );

    const missingAuthz: KafkaTopicOperation[] = this.checkMissingAuthorizedOperations(resource);
    this.tooltip = createKafkaTopicTooltip(this.resource, missingAuthz);
  }

  checkMissingAuthorizedOperations(resource: KafkaTopic): KafkaTopicOperation[] {
    // operations we support via view/item actions that require authorization
    const interestingAuthz: KafkaTopicOperation[] = ["READ", "DELETE", "ALTER_CONFIGS"];

    for (const op of interestingAuthz) {
      if (resource.operations.includes(op)) {
        // Convert to "authzRead", "authzDelete", etc. for context flags to hang context-sensitive commands off of (see package.json)
        const operationTitleCase = op
          .toLowerCase()
          .replace(/_/g, " ") // replace underscores with spaces
          .replace(/^\w|\s\w/g, (c) => c.toUpperCase()) // convert to title case
          .replace(/\s/g, ""); // remove spaces
        this.contextValue += `-authz${operationTitleCase}`;
      }
    }

    return interestingAuthz.filter((op) => !resource.operations.includes(op));
  }
}

function createKafkaTopicTooltip(
  resource: KafkaTopic,
  missingAuthz: KafkaTopicOperation[],
): vscode.MarkdownString {
  const iconName = resource.hasSchema ? IconNames.TOPIC : IconNames.TOPIC_WITHOUT_SCHEMA;

  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${iconName}) Kafka Topic`)
    .appendMarkdown("\n\n---")
    .appendMarkdown(`\n\nName: \`${resource.name}\``)
    .appendMarkdown(`\n\nReplication Factor: \`${resource.replication_factor}\``)
    .appendMarkdown(`\n\nPartition Count: \`${resource.partition_count}\``)
    .appendMarkdown(`\n\nInternal: \`${resource.is_internal}\``);

  if (!resource.hasSchema) {
    tooltip
      .appendMarkdown("\n\n---")
      .appendMarkdown("\n\n$(warning) No schema(s) found for topic.");
  }

  // list any missing authorized operations
  if (missingAuthz.length > 0) {
    tooltip
      .appendMarkdown("\n\n---")
      .appendMarkdown("\n\n$(warning) Missing authorization for the following actions:");
    missingAuthz.forEach((op) => tooltip.appendMarkdown(` - ${op}\n`));
  }

  if (isCCloud(resource)) {
    tooltip.appendMarkdown("\n\n---");
    tooltip.appendMarkdown(
      `\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${resource.ccloudUrl})`,
    );
  }

  return tooltip;
}
