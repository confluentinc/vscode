import {
  Disposable,
  Event,
  EventEmitter,
  ProgressOptions,
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

/** View providers offering our common refresh() pattern. */
export interface RefreshableTreeViewProvider {
  kind: string;
  refresh(forceDeepRefresh?: boolean): void;
}

/** Requirement interfaces for BaseViewProvider data elements */
type BaseViewProviderData = IResourceBase & IdItem & ISearchable & { environmentId: EnvironmentId };

/**
 * Base class for all tree view providers handling a primary resource type.
 * @template T The primary resource(s) that will be shown in the view.
 */
export abstract class BaseViewProvider<T extends BaseViewProviderData>
  implements TreeDataProvider<T>, RefreshableTreeViewProvider
{
  abstract loggerName: string;
  abstract readonly kind: string;
  logger!: Logger;

  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: Disposable[] = [];

  protected _onDidChangeTreeData: EventEmitter<T | undefined | void> = new EventEmitter<
    T | undefined | void
  >();
  readonly onDidChangeTreeData: Event<T | undefined | void> = this._onDidChangeTreeData.event;

  /**
   * Refresh the tree view with data from the current {@linkcode resource} and {@linkcode environment}.
   *
   * Subclasses should ensure that their implementations fire this._onDidChangeTreeData() after doing any
   * data loading.
   * @returns A promise that resolves when and data loading is complete, for when callers need to wait for it.
   */
  async refresh(): Promise<void> {
    this._onDidChangeTreeData.fire();
  }

  protected treeView!: TreeView<T>;
  /**
   * The id of the view associated with this provider, set in `package.json` and used to register {@linkcode treeView} to the provider instance.
   */
  abstract viewId: string;

  /** Optional {@link EventEmitter} to listen for when the search string is set/unset. */
  searchChangedEmitter?: EventEmitter<string | null>;
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
  private static instanceMap = new Map<string, BaseViewProvider<any>>();

  /** Get the singleton instance of this view provider. */
  static getInstance<U extends BaseViewProvider<any>>(this: new () => U): U {
    const className = this.name;
    if (!BaseViewProvider.instanceMap.has(className)) {
      const instance = new this();
      instance.initialize();
      BaseViewProvider.instanceMap.set(className, instance);
    }
    return BaseViewProvider.instanceMap.get(className) as U;
  }

  /** Set up event listeners for this view provider. */
  protected setEventListeners(): Disposable[] {
    const disposables: Disposable[] = [];

    const searchChangedSub: Disposable | undefined = this.searchChangedEmitter?.event(
      (searchString: string | null) => {
        this.setSearch(searchString);
      },
    );
    if (searchChangedSub) {
      disposables.push(searchChangedSub);
    }

    disposables.push(...this.setCustomEventListeners());
    return disposables;
  }

  /** Optional method for subclasses to provide their own event listeners. */
  protected setCustomEventListeners(): Disposable[] {
    return [];
  }

  abstract getChildren(element?: T): T[];

  abstract getTreeItem(element: T): TreeItem;

  /** Convenience method to revert this view to its original state. */
  async reset(): Promise<void> {
    this.logger.debug("reset() called, clearing tree view");

    this.treeView.description = undefined;
    this.treeView.message = undefined;

    this.setSearch(null);

    await this.refresh();
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
    this.searchMatches.clear();

    // Inform the view that parent resource's children have changed and should
    // call getChildren() again.
    this._onDidChangeTreeData.fire();
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
    if (this.searchMatches.size > 0) {
      this.treeView.message = `Showing ${this.searchMatches.size} of ${this.totalItemCount} for "${search}"`;
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
   * Run async task in the context of a
   * progress indicator for this view
   **/
  public async withProgress<T>(
    title: string,
    task: () => Promise<T>,
    cancellable: boolean = false,
  ): Promise<T> {
    const progressOptions: ProgressOptions = {
      location: { viewId: this.viewId },
      title: title,
      cancellable: cancellable,
    };
    return await window.withProgress(progressOptions, task);
  }
}

/**
 * Base class for all tree view providers handling a primary resource type and a parent resource.
 * @template P The type of the "parent" resource that can be "focused" in the view to determine which
 * resources will be shown. (Example: `KafkaCluster`, `SchemaRegistry`, `FlinkComputePool`)
 * @template T The primary resource(s) that will be shown in the view.
 */
export abstract class ParentedBaseViewProvider<
    P extends BaseViewProviderData,
    T extends BaseViewProviderData,
  >
  extends BaseViewProvider<T>
  implements TreeDataProvider<T>, RefreshableTreeViewProvider
{
  /**
   * The focused 'parent' resource instance associated with this provider.
   *
   * Examples:
   * - Topics view: `KafkaCluster`
   * - Schemas view: `SchemaRegistry`
   * - Flink Statements view: `FlinkComputePool`
   * - Flink Artifacts view: `FlinkComputePool`
   */
  resource: P | null = null;

  /** The parent {@link Environment} of the focused resource.  */
  environment: Environment | null = null;

  /**
   * Optional {@link EventEmitter} to listen for when this view provider's parent
   * {@linkcode resource} is set/unset. This is used in order to control the tree view description,
   * context value, and search string updates internally.
   */
  parentResourceChangedEmitter?: EventEmitter<P | null>;
  /** Optional context value to adjust when the parent {@linkcode resource} is set/unset. */
  parentResourceChangedContextValue?: ContextValues;

  /**
   * Set the parent resource for this view provider. If being set to what is already set, the
   * resource will be refreshed.
   *
   * @returns A promise that resolves when the resource is set and any reloads are complete.
   */
  async setParentResource(resource: P | null): Promise<void> {
    this.logger.debug(`setParentResource() called, ${resource ? "refreshing" : "resetting"}.`, {
      resource,
    });

    if (this.resource !== resource) {
      this.setSearch(null); // reset search when parent resource changes
    }

    if (resource) {
      if (this.parentResourceChangedContextValue) {
        setContextValue(this.parentResourceChangedContextValue, true);
      }
      this.resource = resource;
      await this.updateTreeViewDescription();
      await this.refresh();
    } else {
      // edging to empty state
      this.resource = null;
      await this.refresh();
    }
  }

  /** Set up event listeners for this view provider. */
  protected setEventListeners(): Disposable[] {
    const disposables: Disposable[] = super.setEventListeners();

    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      this.handleCCloudConnectionChange(connected);
    });
    disposables.push(ccloudConnectedSub);

    if (this.parentResourceChangedEmitter) {
      const parentResourceChangedSub: Disposable = this.parentResourceChangedEmitter.event(
        async (resource: P | null) => {
          await this.setParentResource(resource);
        },
      );
      disposables.push(parentResourceChangedSub);
    }

    return disposables;
  }

  /** Callback for  */
  handleCCloudConnectionChange(connected: boolean) {
    if (this.resource && isCCloud(this.resource)) {
      // any transition of CCloud connection state should reset the tree view if we're focused on
      // a CCloud parent resource
      this.logger.debug("ccloudConnected event fired, resetting view", { connected });
      void this.reset();
    }
  }

  async reset(): Promise<void> {
    this.resource = null;
    this.environment = null;

    await super.reset();
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
    const parentEnv: Environment | undefined = await ResourceLoader.getEnvironment(
      focusedResource.connectionId,
      focusedResource.environmentId,
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
}
