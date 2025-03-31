import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { CustomMarkdownString } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, isCCloud, ISearchable } from "./resource";

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

export class CCloudFlinkComputePool extends FlinkComputePool {
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
    return `https://confluent.cloud/environments/${this.environmentId}/flink/pools/${this.id}/overview`;
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
  }
}

export function createFlinkComputePoolTooltip(resource: FlinkComputePool) {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${resource.iconName}) Flink Compute Pool\n`)
    .appendMarkdown("\n\n---")
    .appendMarkdown(`\n\nID: \`${resource.id}\``)
    .appendMarkdown(`\n\nName: \`${resource.name}\``);
  if (isCCloud(resource)) {
    const ccloudPool = resource as CCloudFlinkComputePool;
    tooltip.appendMarkdown(`\n\nProvider: \`${ccloudPool.provider}\``);
    tooltip.appendMarkdown(`\n\nRegion: \`${ccloudPool.region}\``);
    tooltip.appendMarkdown(`\n\nMax CFU: \`${ccloudPool.maxCfu}\``);
    tooltip.appendMarkdown("\n\n---");
    tooltip.appendMarkdown(
      `\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudPool.ccloudUrl})`,
    );
  }

  return tooltip;
}
