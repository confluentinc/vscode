import type { TreeItemCollapsibleState } from "vscode";
import { TreeItem } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { IdItem } from "../../models/main";
import type { ConnectionId, IResourceBase, ISearchable } from "../../models/resource";

/** A container {@link TreeItem} for resources to display in the Flink Database view. */
export class FlinkDatabaseResourceContainer<T extends IResourceBase & IdItem & ISearchable>
  extends TreeItem
  implements ISearchable
{
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  children: T[];

  constructor(label: string, collapsibleState: TreeItemCollapsibleState, children: T[]) {
    super(label, collapsibleState);
    this.children = children;
    this.id = `${this.connectionId}-${label}`;
  }

  searchableText(): string {
    // label is required to be a string in the constructor, so we don't support the TreeItem
    // label being undefined or a TreeItemLabel object here
    return this.label as string;
  }
}
