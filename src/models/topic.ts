import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { KafkaTopicOperation } from "../authz/types";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";
/** Main class representing Kafka topic */
export class KafkaTopic extends Data {
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
  /** CCloud env id. If null, implies a "local cluster" topic. */
  environmentId: string | null = null;
  hasSchema: boolean = false;

  /** Operations the user is authzd to perform on the topic */
  operations!: Enforced<KafkaTopicOperation[]>;

  /** Property producing a URL for the topic in the Confluent Cloud UI */
  get ccloudUrl(): string {
    // Only ccloud topics have a ccloud URL.
    if (this.isLocalTopic()) {
      return "";
    }
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.clusterId}/topics/${this.name}/overview`;
  }

  /** Property producing a unique identifier for a topic based on both the cluster id and the topic name */
  get uniqueId(): string {
    return `${this.clusterId}-${this.name}`;
  }

  /** Is this a local cluster topic (if not, then is ccloud)? */
  isLocalTopic(): boolean {
    // as indicated by the (ccloud) environmentId being null
    return this.environmentId == null;
  }

  get connectionId(): string {
    return this.isLocalTopic() ? LOCAL_CONNECTION_ID : CCLOUD_CONNECTION_ID;
  }
}

// Main class controlling the representation of a Kafka topic as a tree item.
export class KafkaTopicTreeItem extends vscode.TreeItem {
  resource: KafkaTopic;

  constructor(resource: KafkaTopic) {
    super(resource.name, vscode.TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    this.contextValue = resource.isLocalTopic() ? "local-kafka-topic" : "ccloud-kafka-topic";
    if (this.resource.hasSchema) {
      this.contextValue += "-with-schema";
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
    const interestingAuthz: KafkaTopicOperation[] = ["READ", "DELETE"];

    for (const op of interestingAuthz) {
      if (resource.operations.includes(op)) {
        // Convert to "authzRead", "authzDelete", etc. for context flags to hang context-sensitive commands off of (see package.json)
        const operationTitleCase = op.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
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
  const tooltip = new CustomMarkdownString();
  const iconName = resource.hasSchema ? "confluent-topic" : "confluent-topic-without-schema";
  tooltip
    .appendMarkdown(`#### $(${iconName}) Kafka Topic`)
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(`Name: \`${resource.name}\`\n\n`)
    .appendMarkdown(`Replication Factor: \`${resource.replication_factor}\`\n\n`)
    .appendMarkdown(`Partition Count: \`${resource.partition_count}\`\n\n`)
    .appendMarkdown(`Internal: \`${resource.is_internal}\`\n\n`);

  if (!resource.hasSchema) {
    tooltip
      .appendMarkdown("---\n\n")
      .appendMarkdown("$(warning) No schema(s) found for topic.\n\n");
  }

  // list any missing authorized operations
  if (missingAuthz.length > 0) {
    tooltip
      .appendMarkdown("---\n\n")
      .appendMarkdown("$(warning) Missing authorization for the following actions:\n\n");
    missingAuthz.forEach((op) => tooltip.appendMarkdown(` - ${op}\n`));
  }

  if (!resource.isLocalTopic()) {
    tooltip.appendMarkdown("---\n\n");
    tooltip.appendMarkdown(`[$(confluent-logo) Open in Confluent Cloud](${resource.ccloudUrl})`);
  }

  return tooltip;
}
