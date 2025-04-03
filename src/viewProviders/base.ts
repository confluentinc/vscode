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
import { ExtensionContextNotSetError } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { IdItem } from "../models/main";
import { EnvironmentId, IResourceBase, ISearchable } from "../models/resource";
import { logUsage, UserEvent } from "../telemetry/events";
import { titleCase } from "../utils";
import { filterItems, itemMatchesSearch } from "./search";

const logger = new Logger("viewProviders.base");

export abstract class BaseViewProvider<
  P extends IResourceBase & IdItem & ISearchable & { environmentId: EnvironmentId },
  T extends IResourceBase & IdItem & ISearchable & { environmentId: EnvironmentId },
> implements TreeDataProvider<T>
{
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: Disposable[] = [];

  private _onDidChangeTreeData: EventEmitter<T | undefined | void> = new EventEmitter<
    T | undefined | void
  >();
  readonly onDidChangeTreeData: Event<T | undefined | void> = this._onDidChangeTreeData.event;

  async refresh(): Promise<void> {
    this._onDidChangeTreeData.fire();
  }

  private treeView!: TreeView<T>;

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

  /** The id of the view associated with this provider, set in package.json. */
  abstract viewId: string;

  public constructor() {
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError(this.constructor.name);
    }
    // defer to initialize() to set up the tree view and disposables
  }

  private initialize(): void {
    this.treeView = window.createTreeView(this.viewId, { treeDataProvider: this });
    const listeners: Disposable[] = this.setEventListeners();
    this.disposables = [this.treeView, ...listeners];
  }

  private static instanceMap = new Map<string, BaseViewProvider<any, any>>();
  static getInstance<U extends BaseViewProvider<any, any>>(this: new () => U): U {
    const className = this.name;
    if (!BaseViewProvider.instanceMap.has(className)) {
      const instance = new this();
      instance.initialize();
      BaseViewProvider.instanceMap.set(className, instance);
    }
    return BaseViewProvider.instanceMap.get(className) as U;
  }

  /** Convenience method to revert this view to its original state. */
  async reset(): Promise<void> {
    logger.debug("reset() called, clearing tree view");
  }

  abstract getChildren(): Promise<T[]>;

  abstract getTreeItem(element: T): TreeItem;

  /** Set up event listeners for this view provider. */
  abstract setEventListeners(): Disposable[];

  /** Filter results from any search applied to the current view. */
  filterChildren(element: T | undefined, children: T[]): T[] {
    this.totalItemCount += children.length;
    if (!this.itemSearchString) {
      this.treeView.message = undefined;
      return children;
    }

    // if the parent item matches the search string, return all children so the user can expand
    // and see them all, even if just the parent item matched and shows the highlight(s)
    const parentMatched = element && itemMatchesSearch(element, this.itemSearchString);
    if (!parentMatched) {
      // filter the children based on the search string
      children = filterItems([...children], this.itemSearchString) as T[];
    }

    // aggregate all elements that directly match the search string (not just how many were
    // returned in the tree view since children of directly-matching parents will be included)
    const matchingChildren = children.filter((child) =>
      itemMatchesSearch(child, this.itemSearchString!),
    );
    matchingChildren.forEach((child) => this.searchMatches.add(child));

    // update the tree view message to show how many results were found to match the search string
    // NOTE: this can't be done in `getTreeItem()` because if we don't return children here, it
    // will never be called and the message won't update
    const plural = this.totalItemCount > 1 ? "s" : "";
    if (this.searchMatches.size > 0) {
      this.treeView.message = `Showing ${this.searchMatches.size} of ${this.totalItemCount} result${plural} for "${this.itemSearchString}"`;
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

  /**
   * Update the tree view description to show the currently-focused resource's parent env
   * name and the resource ID.
   *
   * Reassigns this.environment to the parent environment of the resource.
   * */
  async updateTreeViewDescription(): Promise<void> {
    const subLogger = logger.withCallpoint("updateTreeViewDescription");

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

  /** Update internal state when the search string is set or unset. */
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
}
