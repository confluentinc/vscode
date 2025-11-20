import type {
  Disposable,
  Event,
  ProgressOptions,
  TreeDataProvider,
  TreeItem,
  TreeView,
} from "vscode";
import { EventEmitter, Uri, window } from "vscode";
import { getExtensionContext } from "../../context/extension";
import type { ContextValues } from "../../context/values";
import { setContextValue } from "../../context/values";
import { ExtensionContextNotSetError } from "../../errors";
import { Logger } from "../../logging";
import type { IResourceBaseSearchable } from "../../models/resource";
import { logUsage, UserEvent } from "../../telemetry/events";
import { titleCase } from "../../utils";
import { DisposableCollection } from "../../utils/disposables";
import { updateCollapsibleStateFromSearch } from "../utils/collapsing";
import { filterItems, itemMatchesSearch, SEARCH_DECORATION_URI_SCHEME } from "../utils/search";

/** View providers offering our common refresh() pattern. */
export interface RefreshableTreeViewProvider {
  kind: string;
  refresh(forceDeepRefresh?: boolean): void | Promise<void>;
}

/** Requirement interfaces for BaseViewProvider data elements */
export type BaseViewProviderData = IResourceBaseSearchable;

/**
 * Base class for all tree view providers handling a primary resource type.
 * @template T The primary resource(s) that will be shown in the view.
 */
export abstract class BaseViewProvider<T extends BaseViewProviderData>
  extends DisposableCollection
  implements TreeDataProvider<T>, RefreshableTreeViewProvider
{
  abstract loggerName: string;
  abstract readonly kind: string;
  logger!: Logger;

  protected _onDidChangeTreeData: EventEmitter<T | undefined | void> = new EventEmitter<
    T | undefined | void
  >();
  readonly onDidChangeTreeData: Event<T | undefined | void> = this._onDidChangeTreeData.event;

  /**
   * Refresh the tree view with data from the current {@linkcode resource} and {@linkcode environment}.
   *
   * Subclasses should ensure that their implementations fire this._onDidChangeTreeData() after doing any
   * data loading (or to call super.refresh() to do it for them).
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
  constructor() {
    super();
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
    this.disposables.push(this.treeView, ...listeners);
  }

  /** Map to store instances of subclasses so they don't have to implement their own singleton patterns. */
  private static readonly instanceMap = new Map<string, BaseViewProvider<any>>();

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
    const disposables: Disposable[] = this.setCustomEventListeners();

    if (this.searchChangedEmitter) {
      // Only bind setSearch() as an event handler if the concrete subclass has a searchChangedEmitter defined.
      disposables.push(this.searchChangedEmitter.event(this.setSearch.bind(this)));
    }

    return disposables;
  }

  /** Optional method for subclasses to override and provide their own event listeners. */
  protected setCustomEventListeners(): Disposable[] {
    return [];
  }

  abstract getChildren(element?: T): T[];

  abstract getTreeItem(element: T): TreeItem;

  /**
   * Adjust the given TreeItem based on matching the current {@link itemSearchString search string}, if any.
   * @param element The base model instance corresponding to the TreeItem
   * @param treeItem The TreeItem corresponding to the element.
   */
  adjustTreeItemForSearch(element: T, treeItem: TreeItem): void {
    if (this.itemSearchString) {
      if (itemMatchesSearch(element, this.itemSearchString)) {
        // special URI scheme to decorate the tree item with a dot to the right of the label,
        // and color the label, description, and decoration so it stands out in the tree view
        treeItem.resourceUri = Uri.parse(`${SEARCH_DECORATION_URI_SCHEME}:/${element.id}`);
      }
      if (element.children && element.children.length > 0) {
        updateCollapsibleStateFromSearch(element, treeItem, this.itemSearchString);
      }
    }
  }

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

    if (searchString) {
      // Increment the count of how many times the user has set a search string
      this.searchStringSetCount++;
    }

    // Inform the view that parent resource's children have changed and should
    // call getChildren() again.
    this._onDidChangeTreeData.fire();
  }

  /** Filter results from any {@link itemSearchString search string} applied to the current view. */
  filterChildren(element: T | undefined, children: T[]): T[] {
    if (!element) {
      // if no parent element, we're at the root, so reset the total item count
      // and the searchMatches set for this pass through all the children
      this.totalItemCount = 0;
      this.searchMatches.clear();
    }
    // Always increment the total item count with this amount of children
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
