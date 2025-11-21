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
  defaultVersion: string;
  versionCount: number;
  comment: string | null;
  /** Map of option keys to their values, keyed by version (if version-specific) or 'default' for unversioned options */
  options: Map<string, Map<string, string>>;

  // https://github.com/confluentinc/vscode/issues/2989
  iconName: IconNames = IconNames.PLACEHOLDER;

  constructor(
    props: Pick<
      FlinkAIModel,
      | "environmentId"
      | "provider"
      | "region"
      | "databaseId"
      | "name"
      | "defaultVersion"
      | "versionCount"
      | "comment"
      | "options"
    >,
  ) {
    this.environmentId = props.environmentId;
    this.provider = props.provider;
    this.region = props.region;
    this.databaseId = props.databaseId;

    this.name = props.name;
    this.defaultVersion = props.defaultVersion;
    this.versionCount = props.versionCount;
    this.comment = props.comment;
    // Handle rehydration from cache where Map may have been serialized to a plain object
    this.options = props.options instanceof Map ? props.options : new Map();
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
    .addField("Name", resource.name)
    .addField("Default Version", resource.defaultVersion)
    .addField("Version Count", resource.versionCount.toString());

  if (resource.comment) {
    tooltip.addField("Comment", resource.comment);
  }

  // Add model options if present
  if (resource.options.size > 0) {
    tooltip.addDivider();
    tooltip.appendMarkdown("\n\n**Options:**");
    for (const [version, optionsMap] of resource.options) {
      if (optionsMap.size > 0) {
        const versionLabel = version === "default" ? "Default" : `Version ${version}`;
        tooltip.appendMarkdown(`\n\n_${versionLabel}_:`);
        for (const [key, value] of optionsMap) {
          tooltip.addField(`  ${key}`, value);
        }
      }
    }
  }

  return tooltip;
}
