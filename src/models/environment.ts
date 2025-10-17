import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import {
  CCLOUD_BASE_PATH,
  CCLOUD_CONNECTION_ID,
  IconNames,
  LOCAL_CONNECTION_ID,
  LOCAL_ENVIRONMENT_NAME,
  UTM_SOURCE_VSCODE,
} from "../constants";
import type { FormConnectionType } from "../directConnections/types";
import type { FlinkComputePool } from "./flinkComputePool";
import { CCloudFlinkComputePool } from "./flinkComputePool";
import type { CCloudFlinkDbKafkaCluster, KafkaCluster } from "./kafkaCluster";
import { CCloudKafkaCluster, DirectKafkaCluster, LocalKafkaCluster } from "./kafkaCluster";
import { CustomMarkdownString } from "./main";
import { LocalMedusa } from "./medusa";
import type {
  ConnectionId,
  EnvironmentId,
  IResourceBase,
  ISearchable,
  IUpdatableResource,
} from "./resource";
import { connectionIdToType, isCCloud, isDirect } from "./resource";
import type { SchemaRegistry } from "./schemaRegistry";
import { CCloudSchemaRegistry, DirectSchemaRegistry, LocalSchemaRegistry } from "./schemaRegistry";

/**
 * Base class for an environment, which is a distinct group of resources under a single connection:
 * - {@link KafkaCluster} cluster(s)
 * - {@link SchemaRegistry}
 * ...more, in the future.
 */
export abstract class Environment implements IResourceBase, ISearchable, IUpdatableResource {
  abstract connectionId: ConnectionId;
  abstract connectionType: ConnectionType;
  abstract iconName: IconNames;

  id!: EnvironmentId;
  name!: string;

  /**
   * Has at least one Kafka cluster or Schema Registry.
   *
   * CCloud environemts may have neither (yet), but we still want to show
   * them in the tree.
   */
  kafkaClusters!: KafkaCluster[];
  schemaRegistry?: SchemaRegistry;
  flinkComputePools: FlinkComputePool[] = [];

  // updated by the ResourceViewProvider from connectionUsable events
  // (DirectEnvironment instances are constructed with isLoading = true)
  isLoading: boolean = false;

  get environmentId(): EnvironmentId {
    return this.id;
  }

  get hasClusters(): boolean {
    return (
      this.kafkaClusters.length > 0 || !!this.schemaRegistry || this.flinkComputePools.length > 0
    );
  }

  get children(): ISearchable[] {
    const children: ISearchable[] = [...this.kafkaClusters, ...this.flinkComputePools];
    if (this.schemaRegistry) children.push(this.schemaRegistry);
    return children;
  }

  /** In-place update this Environment with an updated-from-GraphQL instance of the same type. */
  update(other: Environment): void {
    if (this.id !== other.id) {
      throw new Error(`Cannot update Environment with different ID: ${this.id} !== ${other.id}.`);
    }

    // Copy over the possibly changing properties. Singular items ...
    this.name = other.name;
    this.isLoading = other.isLoading;

    this.schemaRegistry = other.schemaRegistry;

    this.kafkaClusters.length = 0; // clear the array
    this.kafkaClusters.push(...other.kafkaClusters); // copy over the new clusters

    this.flinkComputePools.length = 0; // clear the array
    this.flinkComputePools.push(...other.flinkComputePools); // copy over the new pools
  }

  searchableText(): string {
    return `${this.name} ${this.id}`;
  }
}

/** A Confluent Cloud {@link Environment} with additional properties. */
export class CCloudEnvironment extends Environment {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  readonly iconName: IconNames = IconNames.CCLOUD_ENVIRONMENT;

  streamGovernancePackage: string;
  // set explicit CCloud* typing
  kafkaClusters: CCloudKafkaCluster[];
  schemaRegistry?: CCloudSchemaRegistry;
  flinkComputePools: CCloudFlinkComputePool[];

  constructor(
    props: Pick<
      CCloudEnvironment,
      | "id"
      | "name"
      | "streamGovernancePackage"
      | "kafkaClusters"
      | "schemaRegistry"
      | "flinkComputePools"
    >,
  ) {
    super();
    this.id = props.id;
    this.name = props.name;
    this.streamGovernancePackage = props.streamGovernancePackage;
    // Promote each kafka cluster to a CCloudKafkaCluster instance if needed.
    this.kafkaClusters = props.kafkaClusters.map((cluster) =>
      cluster instanceof CCloudKafkaCluster ? cluster : CCloudKafkaCluster.create(cluster),
    );
    // Promote the schema registry to a CCloudSchemaRegistry instance if needed.
    if (props.schemaRegistry) {
      this.schemaRegistry =
        props.schemaRegistry instanceof CCloudSchemaRegistry
          ? props.schemaRegistry
          : CCloudSchemaRegistry.create(props.schemaRegistry);
    } else {
      this.schemaRegistry = undefined;
    }
    this.flinkComputePools = props.flinkComputePools.map((pool) =>
      pool instanceof CCloudFlinkComputePool ? pool : new CCloudFlinkComputePool(pool),
    );
  }
  /**
   * Flinkable Kafka clusters, i.e. those with at least one associated Flink compute pool.
   */
  get flinkDatabaseKafkaClusters(): CCloudFlinkDbKafkaCluster[] {
    if (this.flinkComputePools.length === 0) {
      return [];
    }
    return this.kafkaClusters.filter((kc): kc is CCloudFlinkDbKafkaCluster => kc.isFlinkable());
  }

  get ccloudUrl(): string {
    return `https://${CCLOUD_BASE_PATH}/environments/${this.id}/clusters?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  get children(): ISearchable[] {
    const children: ISearchable[] = [];
    children.push(...this.kafkaClusters.map((cluster) => CCloudKafkaCluster.create(cluster)));
    children.push(
      ...(this.schemaRegistry ? [CCloudSchemaRegistry.create(this.schemaRegistry)] : []),
    );
    children.push(...this.flinkComputePools.map((pool) => new CCloudFlinkComputePool(pool)));
    return children;
  }

  override update(other: CCloudEnvironment): void {
    super.update(other);
    // Copy over the possibly changing CCloud-centric properties.
    this.streamGovernancePackage = other.streamGovernancePackage;
  }
}

/**
 * A "direct" connection's {@link Environment}, which can have at most:
 * - one {@link KafkaCluster}
 * - one {@link SchemaRegistry}
 */
export class DirectEnvironment extends Environment {
  readonly connectionId!: ConnectionId; // dynamically assigned at connection creation time
  readonly connectionType: ConnectionType = ConnectionType.Direct;

  // set explicit Direct* typing
  kafkaClusters: DirectKafkaCluster[] = [];
  /** Was a Kafka cluster configuration provided for this environment (via the `ConnectionSpec`)? */
  kafkaConfigured: boolean = false;
  /** Error message when the connection to the Kafka cluster resulted in a `FAILED` state. */
  kafkaConnectionFailed: string | undefined = undefined;

  schemaRegistry: DirectSchemaRegistry | undefined = undefined;
  /** Was a Schema Registry configuration provided for this environment (via the `ConnectionSpec`)? */
  schemaRegistryConfigured: boolean = false;
  /** Error message when the connection to the Schema Registry resulted in a `FAILED` state. */
  schemaRegistryConnectionFailed: string | undefined = undefined;

  /** What did the user choose as the source of this connection/environment? */
  formConnectionType?: FormConnectionType = "Other";

  constructor(
    props: Pick<
      DirectEnvironment,
      | "connectionId"
      | "id"
      | "name"
      | "kafkaClusters"
      | "kafkaConfigured"
      | "schemaRegistry"
      | "schemaRegistryConfigured"
      | "formConnectionType"
    >,
  ) {
    super();
    this.connectionId = props.connectionId;
    this.id = props.id;
    this.name = props.name;

    // Promote each kafka cluster to a DirectKafkaCluster instance if needed.
    this.kafkaClusters = props.kafkaClusters.map((cluster) =>
      cluster instanceof DirectKafkaCluster ? cluster : DirectKafkaCluster.create(cluster),
    );
    this.kafkaConfigured = props.kafkaConfigured;

    // Promote the schema registry to a DirectSchemaRegistry instance if needed.
    // If no schema registry was provided, set it to undefined.
    if (!props.schemaRegistry) {
      this.schemaRegistry = undefined;
    } else {
      this.schemaRegistry =
        props.schemaRegistry instanceof DirectSchemaRegistry
          ? props.schemaRegistry
          : DirectSchemaRegistry.create(props.schemaRegistry);
    }
    this.schemaRegistryConfigured = props.schemaRegistryConfigured;

    if (props.formConnectionType) this.formConnectionType = props.formConnectionType;

    // newly born direct connections are loading unless we already have children.
    // This will eventually mutate
    // to false when the connection is stable and emitters.connectionStable fires through
    // a real Rube Goldberg machine of events.
    this.isLoading = !this.hasClusters;
  }

  get iconName(): IconNames {
    switch (this.formConnectionType) {
      case "Apache Kafka": {
        return IconNames.APACHE_KAFKA_LOGO;
      }
      case "Confluent Cloud":
      case "Confluent Platform": {
        return IconNames.CONFLUENT_LOGO;
      }
      case "WarpStream": {
        return IconNames.WARPSTREAM_LOGO;
      }
      default: {
        // "Other" or unknown
        return IconNames.CONNECTION;
      }
    }
  }

  /**
   * Compare provided `kafkaClusters` against `kafkaConfigured` and `schemaRegistry` against
   * `schemaRegistryConfigured` to determine whether or not expected resources are missing
   */
  checkForMissingResources(): { missingKafka: boolean; missingSR: boolean } {
    const missingKafka: boolean = this.kafkaConfigured && !this.kafkaClusters.length;
    const missingSR: boolean = this.schemaRegistryConfigured && !this.schemaRegistry;
    return { missingKafka, missingSR };
  }

  searchableText(): string {
    // same as Environment, but `id` isn't used since it isn't visible in the UI
    return this.name;
  }

  override update(other: DirectEnvironment): void {
    super.update(other);

    // Copy over the possibly changing DirectEnvironment-centric properties.
    this.kafkaConfigured = other.kafkaConfigured;
    this.schemaRegistryConfigured = other.schemaRegistryConfigured;
    this.formConnectionType = other.formConnectionType;
    this.kafkaConnectionFailed = other.kafkaConnectionFailed;
    this.schemaRegistryConnectionFailed = other.schemaRegistryConnectionFailed;
  }
}

/** A "local" {@link Environment} manageable by the extension via Docker. */
export class LocalEnvironment extends Environment {
  readonly connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Local;

  readonly iconName = IconNames.LOCAL_RESOURCE_GROUP;

  readonly name: string = LOCAL_ENVIRONMENT_NAME;

  // set explicit Local* typing
  kafkaClusters: LocalKafkaCluster[] = [];
  schemaRegistry?: LocalSchemaRegistry;
  medusa?: LocalMedusa;

  constructor(props: Pick<LocalEnvironment, "id" | "kafkaClusters" | "schemaRegistry" | "medusa">) {
    super();
    this.id = props.id;
    this.kafkaClusters = props.kafkaClusters.map((cluster) =>
      cluster instanceof LocalKafkaCluster ? cluster : LocalKafkaCluster.create(cluster),
    );
    // Promote the schema registry to a LocalSchemaRegistry instance if needed.
    // If no schema registry was provided, set it to undefined.
    if (!props.schemaRegistry) {
      this.schemaRegistry = undefined;
    } else {
      this.schemaRegistry =
        props.schemaRegistry instanceof LocalSchemaRegistry
          ? props.schemaRegistry
          : LocalSchemaRegistry.create(props.schemaRegistry);
    }
    // Promote the medusa to a LocalMedusa instance if needed.
    // If no medusa was provided, set it to undefined.
    if (!props.medusa) {
      this.medusa = undefined;
    } else {
      this.medusa =
        props.medusa instanceof LocalMedusa ? props.medusa : LocalMedusa.create(props.medusa);
    }
  }
  update(other: LocalEnvironment): void {
    super.update(other);
    this.medusa = other.medusa;
  }
}

/**
 * Type of the concrete Environment subclasses.
 * Excludes the abstract base class which lacks a constructor.
 */
export type EnvironmentSubclass =
  | typeof CCloudEnvironment
  | typeof DirectEnvironment
  | typeof LocalEnvironment;

export type EnvironmentType = CCloudEnvironment | DirectEnvironment | LocalEnvironment;
/**
 * Mapping of connection types to their corresponding Environment subclass.
 * @see getEnvironmentClass
 */
const environmentClassByConnectionType: Record<ConnectionType, EnvironmentSubclass> = {
  [ConnectionType.Ccloud]: CCloudEnvironment,
  [ConnectionType.Direct]: DirectEnvironment,
  [ConnectionType.Local]: LocalEnvironment,
};

/**
 * Returns the appropriate Environment subclass for the given connection ID.
 */
export function getEnvironmentClass(connectionId: ConnectionId): EnvironmentSubclass {
  return environmentClassByConnectionType[connectionIdToType(connectionId)];
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
    this.id = `${resource.connectionId}-${resource.id}`;
    this.resource = resource;

    const contextParts: string[] = [];

    if (isCCloud(resource)) {
      if (resource.flinkComputePools.length) {
        contextParts.push("flinkable");
      }
    }
    contextParts.push(`${this.resource.connectionType.toLowerCase()}-environment`);
    // "ccloud-environment", "direct-environment", "local-environment"
    this.contextValue = contextParts.join("-");

    // mainly to help E2E tests distinguish direct connections from other tree items
    this.accessibilityInformation = {
      label: `${this.resource.connectionType}: connection "${resource.name}"`,
    };

    // user-facing properties
    this.description = isDirect(this.resource) ? "" : this.resource.id;
    this.iconPath = new ThemeIcon(this.resource.iconName);

    if (this.resource.isLoading) {
      this.iconPath = new ThemeIcon(IconNames.LOADING);
    } else if (isDirect(resource)) {
      const { missingKafka, missingSR } = (
        resource as DirectEnvironment
      ).checkForMissingResources();
      if (missingKafka || missingSR) {
        this.iconPath = new ThemeIcon("warning", new ThemeColor("problemsErrorIcon.foreground"));
      }
    }
    this.tooltip = createEnvironmentTooltip(this.resource);
  }
}

export function createEnvironmentTooltip(resource: Environment): CustomMarkdownString {
  const tooltip = new CustomMarkdownString();
  if (isCCloud(resource)) {
    tooltip
      .addHeader(`Environment`, resource.iconName)
      .addField("ID", resource.id)
      .addField("Name", resource.name);
    const ccloudEnv = resource as CCloudEnvironment;
    tooltip
      .addField("Stream Governance Package", ccloudEnv.streamGovernancePackage)
      .addCCloudLink(ccloudEnv.ccloudUrl);
  } else if (isDirect(resource)) {
    // Direct connections are treated like environments, but calling it an environment will feel weird
    const directEnv = resource as DirectEnvironment;
    tooltip
      .addHeader(`${directEnv.formConnectionType} Connection`, resource.iconName)
      .addField("ID", resource.id)
      .addField("Name", resource.name);

    // check for any resources that the sidecar reported a `FAILED` connection status.
    // ideally, the ResourceViewProvider would react to events pushed by the ConnectionStateWatcher
    // and update the environments' `kafkaConnectionFailed` and `schemaRegistryConnectionFailed`
    // properties, but in the event we didn't get those websocket events (e.g. new workspace),
    // we can check to see if they're just "missing" based on the expected configuration(s)
    const { missingKafka, missingSR } = directEnv.checkForMissingResources();

    const failedResources = [];
    const missingResources = [];

    if (directEnv.kafkaConnectionFailed) {
      failedResources.push(`**Kafka**: ${directEnv.kafkaConnectionFailed}`);
    } else if (missingKafka) {
      missingResources.push("Kafka");
    }

    if (directEnv.schemaRegistryConnectionFailed) {
      failedResources.push(`**Schema Registry**: ${directEnv.schemaRegistryConnectionFailed}`);
    } else if (missingSR) {
      missingResources.push("Schema Registry");
    }

    if (failedResources.length) {
      tooltip.addWarning("**Unable to connect to**:", "error");
      failedResources.forEach((error) => {
        tooltip.appendMarkdown(`\n\n- ${error}`);
      });
      // provide a command URI as a markdown link
      const commandUri = Uri.parse(
        `command:confluent.connections.direct.edit?${encodeURIComponent(JSON.stringify([resource.connectionId]))}`,
      );
      tooltip.addLink("View Connection Details", commandUri.toString());
    } else if (missingResources.length) {
      tooltip.addWarning(`Unable to connect to ${missingResources.join(" and ")}.`, "error");
    }
  }

  return tooltip;
}
