import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";

/** Main class representing a local Kafka cluster */
export class LocalKafkaCluster extends Data {
  readonly connectionId: string = LOCAL_CONNECTION_ID;
  readonly isLocal: boolean = true;
  readonly isCCloud: boolean = false;

  id!: Enforced<string>;
  bootstrapServers!: Enforced<string>;
  uri!: Enforced<string>;

  // this is solely for display purposes so we don't have to check whether a resource is either a
  // LocalKafkaCluster or CCloudKafkaCluster when generating a label for a tree/quickpick/etc item
  readonly name: string = "Local";
}

/** Main class representing a CCloud Kafka cluster */
export class CCloudKafkaCluster extends Data {
  readonly connectionId: string = CCLOUD_CONNECTION_ID;
  readonly isLocal: boolean = false;
  readonly isCCloud: boolean = true;

  id!: Enforced<string>;
  name!: Enforced<string>;
  provider!: Enforced<string>;
  region!: Enforced<string>;
  bootstrapServers!: Enforced<string>;
  uri!: Enforced<string>;
  // added separately from sidecar responses
  environmentId!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.id}`;
  }
}

export type KafkaCluster = LocalKafkaCluster | CCloudKafkaCluster;

// Main class controlling the representation of a Kafka cluster as a tree item.
export class KafkaClusterTreeItem extends vscode.TreeItem {
  resource: KafkaCluster;

  constructor(resource: KafkaCluster) {
    const label = resource.name;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.resource = resource;
    this.description = `${this.resource.id}`;

    // currently only used to determine whether or not we can show the rename command
    this.contextValue = this.resource.isLocal ? "local-kafka-cluster" : "ccloud-kafka-cluster";

    // TODO: update based on product+design feedback
    this.tooltip = JSON.stringify(resource, null, 2);

    // set icon based on whether this is a CCloud or local cluster
    const iconName = this.resource.isLocal ? IconNames.LOCAL_KAFKA : IconNames.CCLOUD_KAFKA;
    this.iconPath = new vscode.ThemeIcon(iconName);

    this.command = {
      command: "confluent.resources.kafka-cluster.select",
      title: "Set Current Kafka Cluster",
      arguments: [this.resource],
    };
  }
}
