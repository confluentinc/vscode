import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";

export const LOCAL_BROKER_ICON = "server";

export class LocalKafkaBroker extends Data {
  cluster_id!: Enforced<string>;
  broker_id!: Enforced<number>;
  host!: Enforced<string>;
  port!: Enforced<number>;
}

export class LocalKafkaBrokerTreeItem extends vscode.TreeItem {
  resource: LocalKafkaBroker;

  constructor(resource: LocalKafkaBroker) {
    const label = `${resource.broker_id}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.resource = resource;
    this.description = `${resource.host}:${resource.port}`;

    // TODO: update based on product+design feedback
    this.tooltip = JSON.stringify(resource, null, 2);

    // default icon setup
    this.iconPath = new vscode.ThemeIcon(LOCAL_BROKER_ICON);
  }
}
