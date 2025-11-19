import { TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { FlinkDatabaseResource } from "../../models/flinkDatabaseResource";
import type { ConnectionId, ISearchable } from "../../models/resource";

/** A container {@link TreeItem} for resources to display in the Flink Database view. */
export class FlinkDatabaseResourceContainer<T extends FlinkDatabaseResource>
  extends TreeItem
  implements ISearchable
{
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  // `id` is string|undefined in TreeItem, but only string in IdItem so we need to specify it here
  id: string;
  children: T[];

  constructor(label: string, children: T[]) {
    const collapsibleState = children.length
      ? TreeItemCollapsibleState.Collapsed
      : TreeItemCollapsibleState.None;
    super(label, collapsibleState);

    this.children = children;
    this.id = `${this.connectionId}-${label}`;

    this.description = `(${children.length})`;
  }

  searchableText(): string {
    // label is required to be a string in the constructor, so we don't support the TreeItem
    // label being undefined or a TreeItemLabel object here
    return this.label as string;
  }
}
