import { type Require as Enforced } from "dataclass";
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import {
  CCloudKafkaCluster,
  DirectKafkaCluster,
  KafkaCluster,
  LocalKafkaCluster,
} from "./kafkaCluster";
import { CustomMarkdownString } from "./main";
import { ConnectionId, ResourceBase } from "./resource";
import {
  CCloudSchemaRegistry,
  DirectSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
} from "./schemaRegistry";

/**
 * Base class for an environment, which is a distinct group of resources under a single connection:
 * - {@link KafkaCluster} cluster(s)
 * - {@link SchemaRegistry}
 * ...more, in the future.
 */
export abstract class Environment extends ResourceBase {
  abstract iconName: IconNames;

  id!: Enforced<string>;
  name!: Enforced<string>;

  /**
   * Has at least one Kafka cluster or Schema Registry.
   *
   * CCloud environemts may have neither (yet), but we still want to show
   * them in the tree.
   */
  kafkaClusters!: KafkaCluster[];
  schemaRegistry?: SchemaRegistry | undefined;

  get hasClusters(): boolean {
    return this.kafkaClusters.length > 0 || !!this.schemaRegistry;
  }
}

/** A Confluent Cloud {@link Environment} with additional properties. */
export class CCloudEnvironment extends Environment {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = "CCLOUD";
  readonly iconName: IconNames = IconNames.CCLOUD_ENVIRONMENT;

  streamGovernancePackage!: Enforced<string>;
  // set explicit CCloud* typing
  kafkaClusters: CCloudKafkaCluster[] = [];
  schemaRegistry: CCloudSchemaRegistry | undefined = undefined;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.id}/clusters`;
  }
}

/**
 * A "direct" connection's {@link Environment}, which can have at most:
 * - one {@link KafkaCluster}
 * - one {@link SchemaRegistry}
 */
export class DirectEnvironment extends Environment {
  // connectionId is set dynamically at creation time
  connectionType: ConnectionType = "DIRECT";
  // TODO: update this based on feedback from product+design
  readonly iconName = IconNames.EXPERIMENTAL;

  // set explicit Direct* typing
  kafkaClusters: DirectKafkaCluster[] = [];
  schemaRegistry: DirectSchemaRegistry | undefined = undefined;
}

/** A "local" {@link Environment} manageable by the extension via Docker. */
export class LocalEnvironment extends Environment {
  readonly connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  readonly connectionType: ConnectionType = "LOCAL";
  readonly iconName = IconNames.LOCAL_RESOURCE_GROUP;

  // set explicit Local* typing
  kafkaClusters: LocalKafkaCluster[] = [];
  schemaRegistry?: LocalSchemaRegistry | undefined = undefined;
}

/** The representation of an {@link Environment} as a {@link TreeItem} in the VS Code UI. */
export class EnvironmentTreeItem extends TreeItem {
  resource: Environment;

  constructor(resource: Environment) {
    // If has interior clusters, is collapsed and can be expanded.
    const collapseState = resource.hasClusters
      ? TreeItemCollapsibleState.Collapsed
      : TreeItemCollapsibleState.None;

    super(resource.name, collapseState);

    // internal properties
    this.resource = resource;
    this.contextValue = `${this.resource.contextPrefix}-environment`;

    // user-facing properties
    this.description = this.resource.id;
    this.iconPath = new ThemeIcon(this.resource.iconName);
    this.tooltip = createEnvironmentTooltip(this.resource);
  }
}

function createEnvironmentTooltip(resource: Environment): MarkdownString {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${resource.iconName}) Environment`)
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(`ID: \`${resource.id}\`\n\n`)
    .appendMarkdown(`Name: \`${resource.name}\`\n\n`);

  if (resource.isCCloud) {
    const ccloudEnv = resource as CCloudEnvironment;
    tooltip
      .appendMarkdown(`Stream Governance Package: \`${ccloudEnv.streamGovernancePackage}\``)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(
        `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudEnv.ccloudUrl})`,
      );
  }

  return tooltip;
}
