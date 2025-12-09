import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import type { FlinkArtifact } from "./flinkArtifact";
import type { FlinkDatabaseResource } from "./flinkDatabaseResource";
import type { ConnectionId, ISearchable } from "./resource";

/** A container {@link TreeItem} for resources to display in the Flink Database view. */
export class FlinkDatabaseResourceContainer<T extends FlinkDatabaseResource | FlinkArtifact>
  extends TreeItem
  implements ISearchable
{
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  // `id` is string|undefined in TreeItem, but only string in IdItem so we need to specify it here
  id: string;

  _children: T[];
  private _isLoading: boolean = false;

  constructor(label: string, children: T[]) {
    const collapsibleState = TreeItemCollapsibleState.Collapsed;
    super(label, collapsibleState);

    this._children = children;
    this.id = `${this.connectionId}-${label}`;
  }

  get children(): T[] {
    return this._children;
  }

  set children(children: T[]) {
    this._children = children;
    this._isLoading = false;
    this.description = `(${children.length})`;
    this.iconPath = undefined;
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  set isLoading(loading: boolean) {
    this._isLoading = loading;
    this.iconPath = loading ? new ThemeIcon(IconNames.LOADING) : undefined;
  }

  searchableText(): string {
    // label is required to be a string in the constructor, so we don't support the TreeItem
    // label being undefined or a TreeItemLabel object here
    return this.label as string;
  }
}
