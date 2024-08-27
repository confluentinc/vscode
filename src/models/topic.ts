import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";

/** Main class representing Kafka topic */
export class KafkaTopic extends Data {
  name!: Enforced<string>;
  is_internal!: Enforced<boolean>;
  replication_factor!: Enforced<number>;
  partition_count!: Enforced<number>;
  partitions!: Enforced<object>;
  configs!: Enforced<object>;

  clusterId!: Enforced<string>;
  /** CCloud env id. If null, implies a "local cluster" topic. */
  environmentId: string | null = null;
  hasSchema: boolean = false;

  get ccloudUrl(): string {
    // Only ccloud topics have a ccloud URL.
    if (this.isLocalTopic()) {
      return "";
    }
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.clusterId}/topics/${this.name}/overview`;
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
    const label = resource.name;
    // these will always have at least Configurations to expand
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.resource = resource;

    this.contextValue = resource.isLocalTopic() ? "local-kafka-topic" : "ccloud-kafka-topic";

    // TODO: update based on product+design feedback
    this.tooltip = JSON.stringify(resource, null, 2);

    if (resource.hasSchema) {
      this.iconPath = new vscode.ThemeIcon(IconNames.TOPIC);
      this.contextValue = `${this.contextValue}-with-schema`;
    } else {
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.tooltip = `No schema(s) found for topic "${resource.name}".\n\n${this.tooltip}`;
      const warningColor = new vscode.ThemeColor("problemsWarningIcon.foreground");
      this.iconPath = new vscode.ThemeIcon(IconNames.TOPIC_WITHOUT_SCHEMA, warningColor);
    }
  }
}
