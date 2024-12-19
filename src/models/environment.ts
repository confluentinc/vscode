import { Data, type Require as Enforced } from "dataclass";
import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import {
  CCLOUD_CONNECTION_ID,
  IconNames,
  LOCAL_CONNECTION_ID,
  LOCAL_ENVIRONMENT_NAME,
} from "../constants";
import { FormConnectionType } from "../webview/direct-connect-form";
import {
  CCloudKafkaCluster,
  DirectKafkaCluster,
  KafkaCluster,
  LocalKafkaCluster,
} from "./kafkaCluster";
import { CustomMarkdownString } from "./main";
import { ConnectionId, IResourceBase, isCCloud, isDirect } from "./resource";
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
export abstract class Environment extends Data implements IResourceBase {
  abstract connectionId: ConnectionId;
  abstract connectionType: ConnectionType;
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
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

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
  readonly connectionId!: Enforced<ConnectionId>; // dynamically assigned at connection creation time
  readonly connectionType: ConnectionType = ConnectionType.Direct;

  // set explicit Direct* typing
  kafkaClusters: DirectKafkaCluster[] = [];
  schemaRegistry: DirectSchemaRegistry | undefined = undefined;

  /** What did the user choose as the source of this connection/environment? */
  formConnectionType: FormConnectionType = "Other";

  get iconName(): IconNames {
    switch (this.formConnectionType) {
      case "Apache Kafka": {
        return IconNames.APACHE_KAFKA_LOGO;
      }
      case "Confluent Cloud":
      case "Confluent Platform": {
        return IconNames.CONFLUENT_LOGO;
      }
      default: {
        // "Other" or unknown
        return IconNames.CONNECTION;
      }
    }
  }
}

/** A "local" {@link Environment} manageable by the extension via Docker. */
export class LocalEnvironment extends Environment {
  readonly connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Local;

  readonly iconName = IconNames.LOCAL_RESOURCE_GROUP;

  name: Enforced<string> = LOCAL_ENVIRONMENT_NAME as Enforced<string>;

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
    this.contextValue = `${this.resource.connectionType.toLowerCase()}-environment`;

    // user-facing properties
    this.description = isDirect(this.resource) ? "" : this.resource.id;
    this.iconPath = new ThemeIcon(this.resource.iconName);
    if (isDirect(resource) && !resource.hasClusters) {
      this.iconPath = new ThemeIcon("warning", new ThemeColor("problemsWarningIcon.foreground"));
    }
    this.tooltip = createEnvironmentTooltip(this.resource);
  }
}

function createEnvironmentTooltip(resource: Environment): MarkdownString {
  let resourceLabel = "Environment";
  const isDirectResource = isDirect(resource);
  if (isDirectResource) {
    // Direct connections are treated like environments, but calling it an environment will feel weird
    const directEnv = resource as DirectEnvironment;
    resourceLabel = `${directEnv.formConnectionType} Connection`;
  }

  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${resource.iconName}) ${resourceLabel}`)
    .appendMarkdown("\n\n---")
    .appendMarkdown(`\n\nID: \`${resource.id}\``)
    .appendMarkdown(`\n\nName: \`${resource.name}\``);
  if (isCCloud(resource)) {
    const ccloudEnv = resource as CCloudEnvironment;
    tooltip
      .appendMarkdown(`\n\nStream Governance Package: \`${ccloudEnv.streamGovernancePackage}\``)
      .appendMarkdown("\n\n---")
      .appendMarkdown(
        `\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudEnv.ccloudUrl})`,
      );
  } else if (isDirectResource && !resource.hasClusters) {
    tooltip
      .appendMarkdown("\n\n---")
      .appendMarkdown(`\n\n⚠️ Unable to connect to Kafka and/or Schema Registry.`);
    // TODO(shoup): add link to edit connection here
  }

  return tooltip;
}
