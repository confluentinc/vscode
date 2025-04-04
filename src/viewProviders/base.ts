import {
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  TreeView,
  window,
} from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import { ccloudConnected } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { IdItem } from "../models/main";
import { EnvironmentId, IResourceBase, isCCloud, ISearchable } from "../models/resource";
import { logUsage, UserEvent } from "../telemetry/events";
import { titleCase } from "../utils";
import { filterItems, itemMatchesSearch } from "./search";

/**
 * Base class for all tree view providers handling a primary resource type.
 * @template P The type of the "parent" resource that can be "focused" in the view to determine which
 * resources will be shown. (Example: `KafkaCluster`, `SchemaRegistry`, `FlinkComputePool`)
 * @template T The primary resource(s) that will be shown in the view.
 */
export abstract class BaseViewProvider<
  P extends IResourceBase & IdItem & ISearchable & { environmentId: EnvironmentId },
  T extends IResourceBase & IdItem & ISearchable & { environmentId: EnvironmentId },
> implements TreeDataProvider<T>
{
  abstract loggerName: string;
  logger!: Logger;

  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: Disposable[] = [];

  protected _onDidChangeTreeData: EventEmitter<T | undefined | void> = new EventEmitter<
    T | undefined | void
  >();
  readonly onDidChangeTreeData: Event<T | undefined | void> = this._onDidChangeTreeData.event;

  async refresh(): Promise<void> {
    this._onDidChangeTreeData.fire();
  }

  protected treeView!: TreeView<T>;
  /**
   * The id of the view associated with this provider, set in `package.json` and used to register {@linkcode treeView} to the provider instance.
   */
  abstract viewId: string;

  /** The parent {@link Environment} of the focused resource.  */
  environment: Environment | null = null;
  /**
   * The focused resource instance associated with this provider.
   *
   * Examples:
   * - Topics view: `KafkaCluster`
   * - Schemas view: `SchemaRegistry`
   * - Flink Statements view: `FlinkComputePool`
   * - Flink Artifacts view: `FlinkComputePool`
   */
  resource: P | null = null;
  /**
   * Optional {@link EventEmitter} to listen for when this view provider's parent
   * {@linkcode resource} is set/unset. This is used in order to control the tree view description,
   * context value, and search string updates internally.
   */
  parentResourceChangedEmitter?: EventEmitter<P | null>;
  /** Optional context value to adjust when the parent {@linkcode resource} is set/unset. */
  parentResourceChangedContextValue?: ContextValues;

  /** Optional context value to adjust when the search string is set/unset. */
  searchContextValue?: ContextValues;
  /** String to filter items returned by `getChildren`, if provided. */
  itemSearchString: string | null = null;
  /** Count of how many times the user has set a search string */
  searchStringSetCount: number = 0;
  /** Items directly matching the {@linkcode itemSearchString}, if provided. */
  searchMatches: Set<T> = new Set();
  /** Count of all items returned from `getChildren()`. */
  totalItemCount: number = 0;

  // NOTE: this is usually private/protected with a singleton pattern, but needs to be public for
  // the subclasses to be called with .getInstance() properly
  public constructor() {
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError(this.constructor.name);
    }
    // defer to initialize() to set up the tree view and disposables
  }

  /**
   * Separate step from the constructor to allow reference to {@linkcode viewId} and
   * {@linkcode treeView} without requiring them as constructor parameters.
   */
  private initialize(): void {
    this.logger = new Logger(this.loggerName);
    this.treeView = window.createTreeView(this.viewId, { treeDataProvider: this });
    const listeners: Disposable[] = this.setEventListeners();
    this.disposables = [this.treeView, ...listeners];
  }

  /** Map to store instances of subclasses so they don't have to implement their own singleton patterns. */
  private static instanceMap = new Map<string, BaseViewProvider<any, any>>();

  /** Get the singleton instance of this view provider. */
  static getInstance<U extends BaseViewProvider<any, any>>(this: new () => U): U {
    const className = this.name;
    if (!BaseViewProvider.instanceMap.has(className)) {
      const instance = new this();
      instance.initialize();
      BaseViewProvider.instanceMap.set(className, instance);
    }
    return BaseViewProvider.instanceMap.get(className) as U;
  }

  /** Set up event listeners for this view provider. */
  private setEventListeners(): Disposable[] {
    const disposables: Disposable[] = [];

    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      this.handleCCloudConnectionChange(connected);
    });

    const parentResourceChangedSub: Disposable | undefined =
      this.parentResourceChangedEmitter?.event(async (resource: P | null) => {
        this.logger.debug(
          `parent resource change event fired, ${resource ? "refreshing" : "resetting"}.`,
          { resource },
        );
        this.setSearch(null); // reset search when parent resource changes
        if (!resource) {
          this.reset();
        } else {
          if (this.parentResourceChangedContextValue) {
            setContextValue(this.parentResourceChangedContextValue, true);
          }
          this.resource = resource;
          await this.updateTreeViewDescription();
          this.refresh();
        }
      });
    if (parentResourceChangedSub) {
      disposables.push(parentResourceChangedSub);
    }

    disposables.push(ccloudConnectedSub, ...this.setCustomEventListeners());
    return disposables;
  }

  /** Optional method for subclasses to provide their own event listeners. */
  protected setCustomEventListeners(): Disposable[] {
    return [];
  }

  abstract getChildren(element?: T): Promise<T[]>;

  abstract getTreeItem(element: T): TreeItem;

  /** Convenience method to revert this view to its original state. */
  async reset(): Promise<void> {
    this.logger.debug("reset() called, clearing tree view");
    this.environment = null;
    this.resource = null;

    this.treeView.description = undefined;
    this.treeView.message = undefined;

    this.setSearch(null);
    // TODO: update this to adjust associated context value for focused resource(s)

    this.refresh();
  }

  /** Callback for  */
  handleCCloudConnectionChange(connected: boolean) {
    if (this.resource && isCCloud(this.resource)) {
      // any transition of CCloud connection state should reset the tree view if we're focused on
      // a CCloud parent resource
      this.logger.debug("ccloudConnected event fired, resetting view", { connected });
      this.reset();
    }
  }

  /**
   * Update the tree view description to show the currently-focused {@linkcode resource}'s parent
   * {@link Environment} name and the resource ID.
   *
   * Reassigns {@linkcode environment} to the parent {@link Environment} of the {@linkcode resource}.
   * */
  async updateTreeViewDescription(): Promise<void> {
    const subLogger = this.logger.withCallpoint("updateTreeViewDescription");

    const focusedResource = this.resource;
    if (!focusedResource) {
      subLogger.debug("called with no focused resource, clearing view description");
      this.treeView.description = "";
      this.environment = null;
      return;
    }

    subLogger.debug(
      `called with ${focusedResource.constructor.name}, checking for environments...`,
    );
    const loader = ResourceLoader.getInstance(focusedResource.connectionId);
    const envs: Environment[] = await loader.getEnvironments();
    const parentEnv: Environment | undefined = envs.find(
      (env) => env.id === focusedResource.environmentId,
    );
    this.environment = parentEnv ?? null;
    if (parentEnv) {
      subLogger.debug("found environment, setting view description");
      this.treeView.description = `${parentEnv.name} | ${focusedResource.id}`;
    } else {
      subLogger.debug(`couldn't find parent environment for ${focusedResource.constructor.name}`);
      this.treeView.description = "";
    }
  }

  /** Update internal state when the {@link itemSearchString search string} is set or unset. */
  setSearch(searchString: string | null): void {
    // set/unset the filter so any calls to getChildren() will filter appropriately
    this.itemSearchString = searchString;
    if (this.searchContextValue) {
      // set context value to toggle between "search" and "clear search" actions
      setContextValue(this.searchContextValue, searchString !== null);
    }
    // clear from any previous search filter
    this.searchMatches = new Set();
    this.totalItemCount = 0;
  }

  /** Filter results from any {@link itemSearchString search string} applied to the current view. */
  filterChildren(element: T | undefined, children: T[]): T[] {
    this.totalItemCount += children.length;
    if (!this.itemSearchString) {
      this.treeView.message = undefined;
      return children;
    }

    const search: string = this.itemSearchString;

    // if the parent item matches the search string, return all children so the user can expand
    // and see them all, even if just the parent item matched and shows the highlight(s)
    const parentMatched = element && itemMatchesSearch(element, search);
    if (!parentMatched) {
      // filter the children based on the search string
      children = filterItems([...children], search) as T[];
    }

    // aggregate all elements that directly match the search string (not just how many were
    // returned in the tree view since children of directly-matching parents will be included)
    const matchingChildren = children.filter((child) => itemMatchesSearch(child, search));
    matchingChildren.forEach((child) => this.searchMatches.add(child));

    // update the tree view message to show how many results were found to match the search string
    // NOTE: this can't be done in `getTreeItem()` because if we don't return children here, it
    // will never be called and the message won't update
    const plural = this.totalItemCount > 1 ? "s" : "";
    if (this.searchMatches.size > 0) {
      this.treeView.message = `Showing ${this.searchMatches.size} of ${this.totalItemCount} result${plural} for "${search}"`;
    } else {
      // let empty state take over
      this.treeView.message = undefined;
    }

    logUsage(UserEvent.ViewSearchAction, {
      status: "view results filtered",
      view: titleCase(this.viewId.split("-")[1]),
      fromItemExpansion: element !== undefined,
      searchStringSetCount: this.searchStringSetCount,
      filteredItemCount: this.searchMatches.size,
      totalItemCount: this.totalItemCount,
    });

    return children;
  }
}
