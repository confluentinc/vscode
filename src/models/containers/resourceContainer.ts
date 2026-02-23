import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ERROR_ICON, IconNames } from "../../icons";
import { Logger } from "../../logging";
import type { ISearchable } from "../resource";

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
  // enforce string so subclasses set this after super()
  declare id: string;

  abstract loggerName: string;

  private _children: T[];

  private _isLoading: boolean = false;
  private _hasError: boolean = false;
  protected readonly _defaultContextValue: string | undefined;
  protected readonly _defaultIcon: ThemeIcon | undefined;

  protected constructor(label: string, children: T[], contextValue?: string, icon?: ThemeIcon) {
    super(label, TreeItemCollapsibleState.Collapsed);

    this._children = children;

    this._defaultContextValue = contextValue;
    if (contextValue) {
      this.contextValue = contextValue;
    }
    this._defaultIcon = icon;
    this.iconPath = this._defaultIcon;
  }

  // lazy because loggerName is abstract and not available during super() / constructor time
  private _logger?: Logger;
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = new Logger(this.loggerName);
    }
    return this._logger;
  }

  /**
   * Child resources belonging to this container.
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
    this.iconPath = loading ? new ThemeIcon(IconNames.LOADING) : this._defaultIcon;
  }

  get hasError(): boolean {
    return this._hasError;
  }

  /** Set or clear the error state for this container. */
  set hasError(error: boolean) {
    this._hasError = error;
    this.iconPath = error ? ERROR_ICON : this._defaultIcon;

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
