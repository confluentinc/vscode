import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import type { FlinkArtifact } from "./flinkArtifact";
import type { FlinkDatabaseResource } from "./flinkDatabaseResource";
import type { ConnectionId, ISearchable } from "./resource";

/** Labels for the top-level containers in the Flink Database view. */
export enum FlinkDatabaseContainerLabel {
  RELATIONS = "Table/View Relations",
  ARTIFACTS = "Artifacts",
  UDFS = "UDFs",
  AI_CONNECTIONS = "Connections",
  AI_TOOLS = "AI Tools",
  AI_MODELS = "AI Models",
  AI_AGENTS = "AI Agents",
}

/** A container {@link TreeItem} for resources to display in the Flink Database view. */
export class FlinkDatabaseResourceContainer<T extends FlinkDatabaseResource | FlinkArtifact>
  extends TreeItem
  implements ISearchable
{
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  // `id` is string|undefined in TreeItem, but only string in IdItem so we need to specify it here
  id: string;

  private _children: T[];

  private _isLoading: boolean = false;
  private _hasError: boolean = false;
  private readonly _defaultContextValue: string | undefined;

  constructor(label: string, children: T[], contextValue?: string) {
    const collapsibleState = TreeItemCollapsibleState.Collapsed;
    super(label, collapsibleState);

    this._children = children;
    this.id = `${this.connectionId}-${label}`;

    this._defaultContextValue = contextValue;
    if (contextValue) {
      this.contextValue = contextValue;
    }
  }

  /**
   * Flink Database resources belonging to this container.
   * Setting this will clear the internal {@linkcode isLoading} state.
   * If the children array has items, this will also set {@linkcode hasError} to `false`.
   */
  get children(): T[] {
    return this._children;
  }

  set children(children: T[]) {
    this._children = children;
    this.isLoading = false;
    this.description = `(${children.length})`;

    if (children.length > 0) {
      this.hasError = false;
    }
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  set isLoading(loading: boolean) {
    this._isLoading = loading;
    this.iconPath = loading ? new ThemeIcon(IconNames.LOADING) : undefined;
  }

  get hasError(): boolean {
    return this._hasError;
  }

  /** Set or clear the error state for this container. */
  set hasError(error: boolean) {
    this.iconPath = error
      ? new ThemeIcon("warning", new ThemeColor("problemsErrorIcon.foreground"))
      : undefined;
    this._hasError = error;

    if (this._defaultContextValue) {
      // append or remove "-error" suffix to context value based on error state to toggle enablement
      // of resource-specific commands
      this.contextValue = error ? `${this._defaultContextValue}-error` : this._defaultContextValue;
    }
  }

  searchableText(): string {
    // label is required to be a string in the constructor, so we don't support the TreeItem
    // label being undefined or a TreeItemLabel object here
    return this.label as string;
  }
}
