import { Data, type Require as Enforced } from "dataclass";
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";
import { ConnectionId, IResourceBase, ISearchable } from "./resource";

export class LocalMedusa extends Data implements IResourceBase, ISearchable {
  connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  connectionType: ConnectionType = ConnectionType.Local;
  iconName: IconNames = IconNames.CONFLUENT_LOGO; //todo update this to Medusa icon
  readonly name = "Medusa";
  id: string = "local-medusa";
  uri!: Enforced<string>;

  searchableText(): string {
    return `${this.name}`;
  }
}

/** The representation of a {@link LocalMedusa} as a {@link TreeItem} in the VS Code UI. */
export class MedusaTreeItem extends TreeItem {
  constructor(public readonly resource: LocalMedusa) {
    super(resource.name, TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    this.contextValue = `${this.resource.connectionType.toLowerCase()}-medusa`;

    // user-facing properties
    this.description = this.resource.id;
    this.iconPath = new ThemeIcon(this.resource.iconName);
    this.tooltip = createMedusaTooltip(resource);
  }
}

export function createMedusaTooltip(resource: LocalMedusa): MarkdownString {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${resource.iconName}) Medusa`)
    .appendMarkdown("\n\n---");
  if (resource.name) {
    tooltip.appendMarkdown(`\n\nID: \`${resource.id}\``);
  }
  if (resource.uri) {
    tooltip.appendMarkdown(`\n\nURI: \`${resource.uri}\``);
    tooltip.appendMarkdown(`\n\nOpen API Docs: \`${resource.uri}/swagger-ui\``);
  }
  return tooltip;
}
