import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_BASE_PATH, CCLOUD_CONNECTION_ID, IconNames, UTM_SOURCE_VSCODE } from "../constants";
import { CustomMarkdownString } from "./main";
import type {
  ConnectionId,
  EnvironmentId,
  IEnvProviderRegion,
  IResourceBase,
  ISearchable,
} from "./resource";
import { isCCloud } from "./resource";

export abstract class FlinkComputePool implements IResourceBase, ISearchable {
  abstract connectionId: ConnectionId;
  abstract connectionType: ConnectionType;
  iconName: IconNames = IconNames.FLINK_COMPUTE_POOL;

  environmentId!: EnvironmentId;

  id!: string;
  name!: string;

  searchableText(): string {
    return `${this.name} ${this.id}`;
  }
}

export class CCloudFlinkComputePool extends FlinkComputePool implements IEnvProviderRegion {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  provider!: string;
  region!: string;
  maxCfu!: number;

  constructor(
    props: Pick<
      CCloudFlinkComputePool,
      "id" | "name" | "provider" | "region" | "maxCfu" | "environmentId"
    >,
  ) {
    super();
    this.id = props.id;
    this.name = props.name;
    this.provider = props.provider;
    this.region = props.region;
    this.maxCfu = props.maxCfu;
    this.environmentId = props.environmentId;
  }

  get ccloudUrl(): string {
    return `https://${CCLOUD_BASE_PATH}/environments/${this.environmentId}/flink/pools/${this.id}/overview?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  searchableText(): string {
    return `${this.name} ${this.id} ${this.provider}/${this.region}`;
  }
}

export class FlinkComputePoolTreeItem extends TreeItem {
  resource: FlinkComputePool;

  constructor(resource: FlinkComputePool) {
    super(resource.name, TreeItemCollapsibleState.None);

    // internal properties
    this.id = `${resource.connectionId}-${resource.id}`;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-compute-pool`;

    // user-facing properties
    this.iconPath = new ThemeIcon(resource.iconName);
    this.description = resource.id;

    this.tooltip = createFlinkComputePoolTooltip(resource);

    // command that allows the user to select a Flink compute pool and
    // focus it in the Flink Statements view.
    this.command = {
      command: "confluent.statements.flink-compute-pool.select",
      title: "Select Flink Compute Pool",
      arguments: [resource],
    };
  }
}

export function createFlinkComputePoolTooltip(resource: FlinkComputePool) {
  const tooltip = new CustomMarkdownString()
    .addHeader("Flink Compute Pool", resource.iconName)
    .addField("ID", resource.id)
    .addField("Name", resource.name);

  if (isCCloud(resource)) {
    const ccloudPool = resource as CCloudFlinkComputePool;
    tooltip
      .addField("Provider", ccloudPool.provider)
      .addField("Region", ccloudPool.region)
      .addField("Max CFU", ccloudPool.maxCfu.toString());
    tooltip.addCCloudLink(ccloudPool.ccloudUrl);
  }

  return tooltip;
}
