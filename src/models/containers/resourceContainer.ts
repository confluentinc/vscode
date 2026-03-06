import { type MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import type { ConnectionType } from "../../clients/sidecar";
import { ERROR_ICON, IconNames } from "../../icons";
import { Logger } from "../../logging";
import type { ConnectionId, ISearchable } from "../resource";

/** Poll interval to use when waiting for a container to finish loading. */
export const LOADING_POLL_INTERVAL_MS = 100;

/**
 * Abstract base class for container {@link TreeItem tree items} that manage an array of resources
 * with shared loading, error, and children state.
 */
export abstract class ResourceContainer<T extends ISearchable>
  extends TreeItem
  implements ISearchable
{
  // narrow TreeItem.id from `string | undefined` to satisfy IdItem (required by BaseViewProviderData)
  declare id: string;

  // IResourceBase fields required by BaseViewProviderData
  readonly connectionId: ConnectionId;
  readonly connectionType: ConnectionType;

  protected abstract readonly loggerNamePrefix: string;

  private _children: T[];

  private _isLoading: boolean = false;
  private _hasError: boolean = false;
  protected readonly _defaultContextValue: string | undefined;
  protected readonly _defaultIcon: ThemeIcon | undefined;

  constructor(
    connectionId: ConnectionId,
    connectionType: ConnectionType,
    label: string,
    children: T[] = [],
    contextValue?: string,
    icon?: ThemeIcon,
  ) {
    super(label, TreeItemCollapsibleState.Collapsed);

    this.id = `${connectionId}-${label}`;
    this.connectionId = connectionId;
    this.connectionType = connectionType;
    this._children = children;

    this._defaultContextValue = contextValue;
    if (contextValue) {
      this.contextValue = contextValue;
    }
    this._defaultIcon = icon;
    this.iconPath = this._defaultIcon;
  }

  /** Logger name combining the subclass-provided {@link loggerNamePrefix} and instance label. */
  get loggerName(): string {
    return `${this.loggerNamePrefix}.${this.label}`;
  }

  // lazy to avoid allocating a Logger on every container construction
  private _logger?: Logger;
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = new Logger(this.loggerName);
    }
    return this._logger;
  }

  /** Child resources belonging to this container. */
  get children(): T[] {
    return this._children;
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  get hasError(): boolean {
    return this._hasError;
  }

  /** Transition to loading state. Shows loading spinner icon. */
  setLoading(): void {
    this._isLoading = true;
    this._hasError = false;
    this.iconPath = new ThemeIcon(IconNames.LOADING);
  }

  /** Transition to loaded state with results. Clears loading, error, and tooltip. */
  setLoaded(children: T[]): void {
    this._children = children;
    this._isLoading = false;
    this._hasError = false;
    this.description = `(${children.length})`;
    this.iconPath = this._defaultIcon;
    this.tooltip = undefined;
    if (this._defaultContextValue) {
      this.contextValue = this._defaultContextValue;
    }
  }

  /** Transition to error state. Sets error icon, clears children, sets error tooltip. */
  setError(tooltip: string | MarkdownString): void {
    this._children = [];
    this._isLoading = false;
    this._hasError = true;
    this.description = "(0)";
    this.iconPath = ERROR_ICON;
    this.tooltip = tooltip;
    if (this._defaultContextValue) {
      this.contextValue = `${this._defaultContextValue}-error`;
    }
  }

  searchableText(): string {
    // label is required to be a string in the constructor, so we don't support the TreeItem
    // label being undefined or a TreeItemLabel object here
    return this.label as string;
  }

  /** Wait until the container is no longer in a loading state, or timeout after `timeoutMs`. */
  async ensureDoneLoading(timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now();

    while (this.isLoading) {
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error("Timeout waiting for container to finish loading");
      }
      await new Promise((resolve) => setTimeout(resolve, LOADING_POLL_INTERVAL_MS));
    }
  }

  /** Get the container's {@link children resources}, waiting for loading to complete if necessary. */
  async gatherResources(timeoutMs: number = 10000): Promise<T[]> {
    let resources: T[] = [];
    try {
      await this.ensureDoneLoading(timeoutMs);
      resources = this.children;
    } catch (error) {
      // should only be a timeout error:
      this.logger.error(`Error getting resources: ${error}`);
    }
    return resources;
  }
}
