import * as vscode from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import { ExtensionContextNotSetError } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { IdItem } from "../models/main";
import { EnvironmentId, IResourceBase } from "../models/resource";

const logger = new Logger("viewProviders.base");

export abstract class BaseViewProvider<
  T extends IResourceBase & IdItem & { environmentId: EnvironmentId },
> implements vscode.TreeDataProvider<T>
{
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  private _onDidChangeTreeData: vscode.EventEmitter<T | undefined | void> = new vscode.EventEmitter<
    T | undefined | void
  >();
  readonly onDidChangeTreeData: vscode.Event<T | undefined | void> =
    this._onDidChangeTreeData.event;

  async refresh(): Promise<void> {
    this._onDidChangeTreeData.fire();
  }

  private treeView: vscode.TreeView<T>;

  /** The parent {@link Environment} of the focused resource.  */
  environment: Environment | null = null;
  /** The resource instance associated with this provider. */
  resource: T | null = null;

  /** String to filter items returned by `getChildren`, if provided. */
  itemSearchString: string | null = null;
  /** Count of how many times the user has set a search string */
  searchStringSetCount: number = 0;
  /** Items directly matching the {@linkcode itemSearchString}, if provided. */
  searchMatches: Set<T> = new Set();
  /** Count of all items returned from `getChildren()`. */
  totalItemCount: number = 0;

  /** The id of the view associated with this provider, set in package.json. */
  protected viewId: string = "confluent-resource";

  private static instanceMap = new Map<string, BaseViewProvider<any>>();

  protected constructor() {
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError(this.constructor.name);
    }

    this.treeView = vscode.window.createTreeView(this.viewId, { treeDataProvider: this });

    const listeners: vscode.Disposable[] = this.setEventListeners();

    this.disposables = [this.treeView, ...listeners];
  }

  static getInstance<U extends BaseViewProvider<any>>(this: new () => U): U {
    const className = this.name;
    if (!BaseViewProvider.instanceMap.has(className)) {
      BaseViewProvider.instanceMap.set(className, new this());
    }
    return BaseViewProvider.instanceMap.get(className) as U;
  }

  /** Convenience method to revert this view to its original state. */
  async reset(): Promise<void> {
    logger.debug("reset() called, clearing tree view");
  }

  abstract getChildren(): vscode.ProviderResult<T[]>;

  abstract getTreeItem(element: T): vscode.TreeItem;

  /** Set up event listeners for this view provider. */
  abstract setEventListeners(): vscode.Disposable[];

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
    // set context value to toggle between "search" and "clear search" actions
    setContextValue(ContextValues.schemaSearchApplied, searchString !== null);
    // clear from any previous search filter
    this.searchMatches = new Set();
    this.totalItemCount = 0;
  }
}
