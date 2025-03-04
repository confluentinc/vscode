import * as vscode from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import {
  ccloudConnected,
  currentSchemaRegistryChanged,
  environmentChanged,
  localSchemaRegistryConnected,
  schemaSearchSet,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { isCCloud, ISearchable, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { logUsage, UserEvent } from "../telemetry/events";
import { updateCollapsibleStateFromSearch } from "./collapsing";
import { filterItems, itemMatchesSearch, SEARCH_DECORATION_URI_SCHEME } from "./search";

const logger = new Logger("viewProviders.schemas");

/**
 * The types managed by the {@link SchemasViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type SchemasViewProviderData = Subject | Schema;

export class SchemasViewProvider implements vscode.TreeDataProvider<SchemasViewProviderData> {
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  private _onDidChangeTreeData: vscode.EventEmitter<SchemasViewProviderData | undefined | void> =
    new vscode.EventEmitter<SchemasViewProviderData | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SchemasViewProviderData | undefined | void> =
    this._onDidChangeTreeData.event;

  // Did the user use the 'refresh' button / command to force a deep refresh of the tree?
  private forceDeepRefresh: boolean = false;

  // Map of subject string -> subject object currently in the tree view.
  private subjectsInTreeView: Map<string, Subject> = new Map();

  /** (Re)paint the view. If forceDeepRefresh=true, then will force a deep fetch of the schemas
   * in the schema registry.
   */
  refresh(forceDeepRefresh: boolean = false): void {
    this.forceDeepRefresh = forceDeepRefresh;
    this._onDidChangeTreeData.fire();
  }

  /** Refresh just this single subject by its string. Caller provides  */
  refreshSubject(subjectString: string, newSchemas: Schema[]): void {
    const element = this.subjectsInTreeView.get(subjectString);
    if (!element) {
      logger.error("Strange, couldn't find subject in tree view", { subjectString });
      return;
    }

    logger.debug(`refreshing subject ${subjectString}, now with ${newSchemas.length} schemas`, {
      newSchemas,
    });

    element.schemas = newSchemas;
    this._onDidChangeTreeData.fire(element);
  }

  private treeView: vscode.TreeView<SchemasViewProviderData>;
  /** The parent of the focused Schema Registry.  */
  public environment: Environment | null = null;
  /** The focused Schema Registry; set by clicking a Schema Registry item in the Resources view. */
  public schemaRegistry: SchemaRegistry | null = null;

  /** String to filter items returned by `getChildren`, if provided. */
  itemSearchString: string | null = null;
  /** Count of how many times the user has set a search string */
  searchStringSetCount: number = 0;
  /** Items directly matching the {@linkcode itemSearchString}, if provided. */
  searchMatches: Set<SchemasViewProviderData> = new Set();
  /** Count of all items returned from `getChildren()`. */
  totalItemCount: number = 0;

  private static instance: SchemasViewProvider | null = null;
  private constructor() {
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError("SchemasViewProvider");
    }

    this.treeView = vscode.window.createTreeView("confluent-schemas", { treeDataProvider: this });

    const listeners: vscode.Disposable[] = this.setEventListeners();

    this.disposables = [this.treeView, ...listeners];
  }

  static getInstance(): SchemasViewProvider {
    if (!SchemasViewProvider.instance) {
      SchemasViewProvider.instance = new SchemasViewProvider();
    }
    return SchemasViewProvider.instance;
  }

  /** Convenience method to revert this view to its original state. */
  reset(): void {
    setContextValue(ContextValues.schemaRegistrySelected, false);
    this.environment = null;
    this.schemaRegistry = null;
    this.treeView.description = "";
    this.setSearch(null);
    this.refresh();
  }

  // we're not handling just `Schema` here since we may be expanding a container tree item
  getTreeItem(element: SchemasViewProviderData): vscode.TreeItem {
    let treeItem: vscode.TreeItem;

    if (element instanceof Subject) {
      logger.debug(
        `schema view controller getTreeItem called on subject ${element.name}, ${element.schemas?.length}`,
      );

      treeItem = new SubjectTreeItem(element);
    } else {
      // must be a Schema
      treeItem = new SchemaTreeItem(element);
    }

    if (this.itemSearchString) {
      if (itemMatchesSearch(element, this.itemSearchString)) {
        // special URI scheme to decorate the tree item with a dot to the right of the label,
        // and color the label, description, and decoration so it stands out in the tree view
        treeItem.resourceUri = vscode.Uri.parse(`${SEARCH_DECORATION_URI_SCHEME}:/${element.id}`);
      }
      treeItem = updateCollapsibleStateFromSearch(element, treeItem, this.itemSearchString);
    }

    return treeItem;
  }

  getParent(element: SchemasViewProviderData): SchemasViewProviderData | null {
    logger.debug("getParent called", { element });
    if (element instanceof Schema) {
      // if we're a schema, our parent is our Subject as found in our map
      return this.subjectsInTreeView.get(element.subject)!;
    }
    // Otherwise the parent of a container tree item is the root.
    return null;
  }

  async getChildren(element?: SchemasViewProviderData): Promise<SchemasViewProviderData[]> {
    // we should get the following hierarchy/structure of tree items from this method:
    // - topic1-value (Subject w/o schemas fetched preemptively)
    //   - schema1-V2 (Schema) (once the Subject is expanded)
    //   - schema1-V1 (Schema) (once the Subject is expanded)
    // - topic2-value (Subject w/o schemas fetched preemptively)
    //   - schema2-V1 (Schema) (once the Subject is expanded)
    //
    // Once the user has asked to expand a Subject, we'll on-demand fetch the Schema[] for
    // just that single Subject and return them as the children of the Subject.

    logger.debug(
      `schema view controller getChildren called with ${element ? "a subject" : "nothing"}, , ${(element as any)?.schemas?.length}`,
    );

    if (!this.schemaRegistry) {
      // No Schema Registry selected, so no subjects or schemas to show.
      return [];
    }

    // What will be returned.
    let children: SchemasViewProviderData[];

    const loader = ResourceLoader.getInstance(this.schemaRegistry.connectionId);

    if (element == null) {
      // Toplevel: return the subjects as Subject[].
      children = await loader.getSubjects(this.schemaRegistry, this.forceDeepRefresh);

      // Cache the subjects in the map for later refresh by object identity.
      // clear the map first to avoid stale entries if we switched SRs or deep refreshed
      this.subjectsInTreeView.clear();
      (children as Subject[]).forEach((subject: Subject) =>
        this.subjectsInTreeView.set(subject.name, subject),
      );
    } else if (element instanceof Subject) {
      // be sure to be using subject as found in subjectsInTreeView.
      element = this.subjectsInTreeView.get(element.name);
      if (!element) {
        logger.error("Strange, couldn't find subject in tree view", { element });
        return [];
      }
      if (element.schemas) {
        // Already fetched the schemas for this subject.
        logger.warn("Wacky: getChildren() called on subject with known schemas already.");
        return element.schemas;
      } else {
        // Selected a subject, so assign children to the schemas bound to the subject,
        // which we fetch now on demand.
        // While here, also update the subject with knowledge of the schemas
        // so that 1) we don't fetch them again, and
        // 2) we can update the TreeItem with additional information based on the schemas.
        children = await loader.getSchemaSubjectGroup(this.schemaRegistry, element.name);

        // Update the in-subjectsInTreeView subject with the now-known schemas.
        element.schemas = children as Schema[];

        // Update the tree item for the subject to reflect the new schemas.
        this._onDidChangeTreeData.fire(element);
      }
    } else {
      // Selected a schema, no children there.
      children = [];
    }

    this.totalItemCount += children.length;
    if (this.itemSearchString) {
      // if the parent item matches the search string, return all children so the user can expand
      // and see them all, even if just the parent item matched and shows the highlight(s)
      const parentMatched = element && itemMatchesSearch(element, this.itemSearchString);
      if (!parentMatched) {
        // filter the children based on the search string
        children = filterItems(
          [...children] as ISearchable[],
          this.itemSearchString,
        ) as SchemasViewProviderData[];
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
        view: "Schemas",
        fromItemExpansion: element !== undefined,
        searchStringSetCount: this.searchStringSetCount,
        filteredItemCount: this.searchMatches.size,
        totalItemCount: this.totalItemCount,
      });
    } else {
      this.treeView.message = undefined;
    }

    if (this.forceDeepRefresh) {
      // Just honored the user's request for a deep refresh.
      this.forceDeepRefresh = false;
    }

    return children;
  }

  /** Set up event listeners for this view provider. */
  setEventListeners(): vscode.Disposable[] {
    const environmentChangedSub: vscode.Disposable = environmentChanged.event(
      async (envId: string) => {
        if (this.schemaRegistry && this.schemaRegistry.environmentId === envId) {
          logger.debug(
            "environmentChanged event fired with matching SR env ID, updating view description",
            {
              envId,
            },
          );
          await this.updateTreeViewDescription();
          this.refresh();
        }
      },
    );

    const ccloudConnectedSub: vscode.Disposable = ccloudConnected.event((connected: boolean) => {
      if (this.schemaRegistry && isCCloud(this.schemaRegistry)) {
        logger.debug("ccloudConnected event fired, resetting", { connected });
        // any transition of CCloud connection state should reset the tree view
        this.reset();
      }
    });

    const localSchemaRegistryConnectedSub: vscode.Disposable = localSchemaRegistryConnected.event(
      (connected: boolean) => {
        if (this.schemaRegistry && isLocal(this.schemaRegistry)) {
          logger.debug("localSchemaRegistryConnected event fired, resetting", { connected });
          // any transition of local schema registry connection state should reset the tree view
          this.reset();
        }
      },
    );

    const currentSchemaRegistryChangedSub: vscode.Disposable = currentSchemaRegistryChanged.event(
      async (schemaRegistry: SchemaRegistry | null) => {
        logger.debug(
          `currentSchemaRegistryChanged event fired, ${schemaRegistry ? "refreshing" : "resetting"}.`,
          { schemaRegistry },
        );
        this.setSearch(null); // reset search when SR changes
        if (!schemaRegistry) {
          this.reset();
        } else {
          setContextValue(ContextValues.schemaRegistrySelected, true);
          this.schemaRegistry = schemaRegistry;
          await this.updateTreeViewDescription();
          this.refresh();
        }
      },
    );

    const schemaSearchSetSub: vscode.Disposable = schemaSearchSet.event(
      (searchString: string | null) => {
        logger.debug("schemaSearchSet event fired, refreshing", { searchString });
        // mainly captures the last state of the search internals to see if search was adjusted after
        // a previous search was used, or if this is the first time search is being used
        if (searchString !== null) {
          // used to group search events without sending the search string itself
          this.searchStringSetCount++;
        }
        logUsage(UserEvent.ViewSearchAction, {
          status: `search string ${searchString ? "set" : "cleared"}`,
          view: "Schemas",
          searchStringSetCount: this.searchStringSetCount,
          hadExistingSearchString: this.itemSearchString !== null,
          lastFilteredItemCount: this.searchMatches.size,
          lastTotalItemCount: this.totalItemCount,
        });
        this.setSearch(searchString);
        this.refresh();
      },
    );

    return [
      environmentChangedSub,
      ccloudConnectedSub,
      localSchemaRegistryConnectedSub,
      currentSchemaRegistryChangedSub,
      schemaSearchSetSub,
    ];
  }

  /** Update the tree view description to show the currently-focused Schema Registry's parent env
   * name and the Schema Registry ID. */
  async updateTreeViewDescription(): Promise<void> {
    const schemaRegistry = this.schemaRegistry;
    if (!schemaRegistry) {
      return;
    }
    const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);
    const envs = await loader.getEnvironments();
    const parentEnv = envs.find((env) => env.id === schemaRegistry.environmentId);
    this.environment = parentEnv ?? null;
    if (parentEnv) {
      this.treeView.description = `${parentEnv.name} | ${schemaRegistry.id}`;
    } else {
      logger.warn("couldn't find parent environment for Schema Registry", {
        schemaRegistry,
      });
      this.treeView.description = schemaRegistry.id;
    }
  }

  /** Try to reveal+expand schema under a subject, if present */
  revealSchemas(subjectString: string): void {
    logger.debug("revealSchemas called", { subjectString });
    const subject = this.subjectsInTreeView.get(subjectString);
    if (!subject) {
      logger.error("Strange, couldn't find subject in tree view", { subjectString });
      return;
    }
    const schema = subject.schemas?.[0];
    if (!schema) {
      logger.error("Strange, found subject but it had no contained schemas at this time", {
        subjectString,
      });
      return;
    }

    this.treeView.reveal(schema, { focus: true, select: true, expand: true });
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

/** Get the singleton instance of the {@link SchemasViewProvider} */
export function getSchemasViewProvider() {
  return SchemasViewProvider.getInstance();
}
