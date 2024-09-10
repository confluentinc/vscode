import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { KafkaTopicOperation } from "../authz/types";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
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
    // these will always have at least Configurations to expand
    super(resource.name, vscode.TreeItemCollapsibleState.Collapsed);

    const tooltipBuf: string[] = [];

    this.resource = resource;

    this.contextValue = resource.isLocalTopic() ? "local-kafka-topic" : "ccloud-kafka-topic";

    // Convert 'read' and 'delete' operations to context flags to hang context-sensitive commands off of.
    // (these are interesting because we invite specific actions based on their presence)
    const interestingAuthz: KafkaTopicOperation[] = ["READ", "DELETE"];
    const missingAuthz: KafkaTopicOperation[] = [];
    for (const op of interestingAuthz) {
      if (resource.operations.includes(op)) {
        // Convert to "authzRead", "authzDelete", etc. for context flags to hang context-sensitive commands off of (see package.json)
        const operationTitleCase = op.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
        this.contextValue += `-authz${operationTitleCase}`;
      } else {
        missingAuthz.push(op);
      }
    }

    if (missingAuthz.length > 0) {
      tooltipBuf.push("⚠️ Missing authorization for the following actions:");
      missingAuthz.forEach((op) => tooltipBuf.push(` * ${op}`));
      tooltipBuf.push("");
    }

    if (resource.hasSchema) {
      this.iconPath = new vscode.ThemeIcon(IconNames.TOPIC);
      this.contextValue = `${this.contextValue}-with-schema`;
    } else {
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.iconPath = new vscode.ThemeIcon(
        IconNames.TOPIC_WITHOUT_SCHEMA,
        new vscode.ThemeColor("problemsWarningIcon.foreground"),
      );
      tooltipBuf.push("⚠️ No schema(s) found for topic.");
      tooltipBuf.push("");
    }

    this.tooltip = tooltipBuf.join("\n");
  }
}
