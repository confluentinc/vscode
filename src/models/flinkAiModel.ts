import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import type { IdItem } from "./main";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

export class FlinkAIModel implements IResourceBase, IdItem, ISearchable {
  connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  connectionType: ConnectionType = ConnectionType.Ccloud;
  environmentId: EnvironmentId;
  provider: string;
  region: string;
  databaseId: string;

  name: string;

  // https://github.com/confluentinc/vscode/issues/2989
  iconName: IconNames = IconNames.PLACEHOLDER;

  constructor(
    props: Pick<FlinkAIModel, "environmentId" | "provider" | "region" | "databaseId" | "name">,
  ) {
    this.environmentId = props.environmentId;
    this.provider = props.provider;
    this.region = props.region;
    this.databaseId = props.databaseId;

    this.name = props.name;
  }

  get id(): string {
    return `${this.environmentId}-${this.databaseId}-${this.name}`;
  }

  searchableText(): string {
    const parts = [];
    parts.push(this.name);
    return parts.join(" ");
  }
}

export class FlinkAIModelTreeItem extends TreeItem {
  resource: FlinkAIModel;

  constructor(resource: FlinkAIModel) {
    super(resource.name, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon(resource.iconName);
    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-model`;

    this.tooltip = createFlinkModelToolTip(resource);
  }
}

export function createFlinkModelToolTip(resource: FlinkAIModel): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Flink AI Model", resource.iconName)
    .addField("Name", resource.name);

  return tooltip;
}
