import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { ConnectionId, IResourceBase, ISearchable } from "./resource";

export class LocalMedusa implements IResourceBase, ISearchable {
  connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  connectionType: ConnectionType = ConnectionType.Local;
  iconName: IconNames = IconNames.CONFLUENT_LOGO; //todo update this to Medusa icon
  readonly name = "Medusa";
  id: string = "local-medusa";

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
    this.tooltip = "Local Medusa instance";
  }
}
