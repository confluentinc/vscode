import * as vscode from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import {
  ccloudConnected,
  currentSchemaRegistryChanged,
  environmentChanged,
  EnvironmentChangeEvent,
  localSchemaRegistryConnected,
  schemaSearchSet,
  schemaSubjectChanged,
  SchemaVersionChangeEvent,
  schemaVersionsChanged,
  SubjectChangeEvent,
} from "../emitters";
import { ExtensionContextNotSetError, logError } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { isCCloud, ISearchable, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { logUsage, UserEvent } from "../telemetry/events";
import { RefreshableTreeViewProvider } from "./base";
import { updateCollapsibleStateFromSearch } from "./collapsing";
import { filterItems, itemMatchesSearch, SEARCH_DECORATION_URI_SCHEME } from "./search";

const logger = new Logger("viewProviders.schemas");

/**
 * The types managed by the {@link SchemasViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type SchemasViewProviderData = Subject | Schema;

export class SchemasViewProvider
  implements vscode.TreeDataProvider<SchemasViewProviderData>, RefreshableTreeViewProvider
{
  readonly kind = "schemas";
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  private _onDidChangeTreeData: vscode.EventEmitter<SchemasViewProviderData | undefined | void> =
    new vscode.EventEmitter<SchemasViewProviderData | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<SchemasViewProviderData | undefined | void> =
    this._onDidChangeTreeData.event;

  // Map of subject string -> subject object currently in the tree view.
  private subjectsInTreeView: Map<string, Subject> = new Map();

  /**
   * (Re)paint the view. If forceDeepRefresh=true, then will force a deep fetch of the schemas
   * in the schema registry.
   */
  async refresh(forceDeepRefresh: boolean = false): Promise<void> {
    await vscode.window.withProgress(
      {
        location: { viewId: this.viewId },
        title: "Loading subject...",
      },
      async () => {
        // Out with any existing subjects.
        this.subjectsInTreeView.clear();

        if (this.schemaRegistry !== null) {
          const loader = ResourceLoader.getInstance(this.schemaRegistry.connectionId);

          // Fetch subjects using the loader, pushing down need to do deep refresh.
          const subjects: Subject[] = await loader.getSubjects(
            this.schemaRegistry,
            forceDeepRefresh,
          );

          // Repopulate this.subjectsInTreeView from getSubjects() result.
          subjects.forEach((subject: Subject) =>
            this.subjectsInTreeView.set(subject.name, subject),
          );
        }

        // Indicate to view that toplevel items have changed.
        this._onDidChangeTreeData.fire();
      },
    );
  }

  /**
   * Refresh just this single subject by its string. Will ensure
   * that the corresponding Subject as found in this.subjectsInTreeView will have
   * its schemas array updated with the new schemas, either those provided
   * or those fetched from the schema registry / loader.
   *
   * @param subjectString - The string identifier of the subject to refresh.
   * @param newSchemas - The new array of schemas to update the subject with.
   */
  async updateSubjectSchemas(subjectString: string, newSchemas: Schema[] | null): Promise<void> {
    await vscode.window.withProgress(
      {
        location: { viewId: this.viewId },
        title: `Loading ${subjectString}...`,
      },
      async () => {
        logger.debug("updateSubjectSchemas(): Refreshing single subject in tree view", {
          subject: subjectString,
          newSchemaCount: newSchemas?.length,
        });

        if (newSchemas === null) {
          // Go get the schemas for this subject
          if (!this.schemaRegistry) {
            throw new Error("No schema registry");
          }
          const loader = ResourceLoader.getInstance(this.schemaRegistry.connectionId);
          newSchemas = await loader.getSchemasForSubject(this.schemaRegistry, subjectString);
        }

        const subjectInMap = this.subjectsInTreeView.get(subjectString);
        if (!subjectInMap) {
          logger.error("Strange, couldn't find subject in tree view", { subjectString });
          return;
        }

        subjectInMap.schemas = newSchemas;

        this._onDidChangeTreeData.fire(subjectInMap);
      },
    );
  }

  readonly viewId: string = "confluent-schemas";
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

    this.treeView = vscode.window.createTreeView(this.viewId, { treeDataProvider: this });

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
  async reset(): Promise<void> {
    logger.debug("reset() called, clearing tree view");
    await this.setSchemaRegistry(null);
  }

  /** Change what SR is being viewed (if any) */
  async setSchemaRegistry(schemaRegistry: SchemaRegistry | null): Promise<void> {
    if (
      // handles exact object reference or both nulls.
      schemaRegistry === this.schemaRegistry ||
      // handles same ID but different object reference
      (schemaRegistry && this.schemaRegistry?.id === schemaRegistry.id)
    ) {
      logger.debug("setSchemaRegistry() called with same SR as being viewed already, ignoring.");
      return;
    }

    logger.debug(
      `setSchemaRegistry called, ${schemaRegistry ? "changing to new registry" : "resetting to empty"}.`,
      {
        id: schemaRegistry?.id,
      },
    );

    this.schemaRegistry = schemaRegistry;

    // Internally handles updating this.treeview.description and this.environment
    // (schema registries are always different envs -- only one SR per env)
    await this.updateTreeViewDescription();

    // Set the context value to indicate whether a schema registry is selected.
    await setContextValue(ContextValues.schemaRegistrySelected, schemaRegistry !== null);

    // Always clear any existing search string.
    this.setSearch(null);

    // Clear or refresh the tree view subjects.
    await this.refresh();
  }

  // we're not handling just `Schema` here since we may be expanding a container tree item
  getTreeItem(element: SchemasViewProviderData): vscode.TreeItem {
    let treeItem: vscode.TreeItem;

    if (element instanceof Subject) {
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
    if (element instanceof Schema) {
      // if we're a schema, our parent is the schema's Subject as found in our map
      const subject = this.subjectsInTreeView.get(element.subject);
      if (!subject) {
        logger.error("Strange, couldn't find subject in tree view", { element });
        return null;
      }
      return subject;
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

    if (!this.schemaRegistry) {
      // No Schema Registry selected, so no subjects or schemas to show.
      return [];
    }

    // What will be returned.
    let children: SchemasViewProviderData[];

    if (element == null) {
      // Get children as the subjects in our map
      children = [...this.subjectsInTreeView.values()];
      logger.debug(`getChildren(): no element, assigned ${children.length} subjects`);
    } else if (element instanceof Subject) {
      // be sure to be using subject as found in subjectsInTreeView.
      element = this.subjectsInTreeView.get(element.name);
      if (!element) {
        return [];
      }
      if (element.schemas) {
        // Already fetched the schemas for this subject.
        children = element.schemas;
      } else {
        // Need to fetch schemas for the subject. Kick off in background. In
        // the meantime, return an empty array to indicate no children (at this time).
        children = [];
        // updateSubjectSchemas() is async and won't begin until this call to getChildren() completes.
        // When it is done, it will update the tree view.
        void this.updateSubjectSchemas(element.name, null);
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

    return children;
  }

  /** Set up event listeners for this view provider. */
  setEventListeners(): vscode.Disposable[] {
    const environmentChangedSub: vscode.Disposable = environmentChanged.event(
      async (envEvent: EnvironmentChangeEvent) => {
        if (this.schemaRegistry && this.schemaRegistry.environmentId === envEvent.id) {
          if (!envEvent.wasDeleted) {
            logger.debug(
              "environmentChanged event fired with matching SR env ID, updating view description",
              {
                envEvent,
              },
            );
            await this.updateTreeViewDescription();
            await this.refresh();
          } else {
            logger.debug(
              "environmentChanged deletion event fired with matching SR env ID, resetting view",
              {
                envEvent,
              },
            );
            // environment was deleted, reset the view
            await this.reset();
          }
        }
      },
    );

    const ccloudConnectedSub: vscode.Disposable = ccloudConnected.event(
      async (connected: boolean) => {
        if (this.schemaRegistry && isCCloud(this.schemaRegistry)) {
          // any transition of CCloud connection state should reset the tree view
          // if we were previously looking at a ccloud-based SR.
          logger.debug("ccloudConnected event fired while set to a CC-based SR, resetting", {
            connected,
          });
          await this.reset();
        }
      },
    );

    const localSchemaRegistryConnectedSub: vscode.Disposable = localSchemaRegistryConnected.event(
      async (connected: boolean) => {
        if (this.schemaRegistry && isLocal(this.schemaRegistry)) {
          logger.debug(
            "localSchemaRegistryConnected event fired while set to local SR, resetting",
            { connected },
          );
          // any transition of local schema registry connection state should reset the tree view
          await this.reset();
        }
      },
    );

    const currentSchemaRegistryChangedSub: vscode.Disposable = currentSchemaRegistryChanged.event(
      async (schemaRegistry: SchemaRegistry | null) => {
        // User has either selected a (probably different) SR to view, or has closed
        // a connection to a SR (null). React accordingly.
        logger.debug("currentSchemaRegistryChanged event fired");
        await this.setSchemaRegistry(schemaRegistry);
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

    // A subject was added or removed.
    const schemaSubjectChangedSub: vscode.Disposable = schemaSubjectChanged.event(
      (event: SubjectChangeEvent) => {
        // A subject was added or deleted. Refresh toplevel view if we're looking at
        // the same schema registry.
        const [subject, change] = [event.subject, event.change];

        if (this.schemaRegistry?.id === subject.schemaRegistryId) {
          logger.debug(`A subject ${change} in the registry being viewed, refreshing toplevel`, {
            subject: subject.name,
          });

          if (change === "deleted") {
            this.subjectsInTreeView.delete(subject.name);
          } else {
            // Otherwise, add it to the map. It will be carrying the new known single
            // schema within its `.schemas`
            this.subjectsInTreeView.set(subject.name, subject);
          }
          // Toplevel repaint.
          this.refresh();
        }
      },
    );

    // A schema version was added or removed, but the subject remains and has
    // at least one schema version.
    const schemaVersionsChangedSub: vscode.Disposable = schemaVersionsChanged.event(
      (event: SchemaVersionChangeEvent) => {
        // A schema version was added or deleted. Refresh the subject if we're looking at
        // the same schema registry.
        const [updatedSubject, change] = [event.subject, event.change];
        if (this.schemaRegistry?.id === updatedSubject.schemaRegistryId) {
          logger.debug(
            `A schema version ${change} in the registry being viewed, refreshing subject`,
            { subject: updatedSubject.name },
          );

          // find the subject in the tree view and refresh just that subtree
          // Blow away the schemas in the cached subject, so that they will be
          // refetched when the subject is expanded, then either showing an added
          // schema or removing the deleted schema from the child treeitems.
          const existingSubject = this.subjectsInTreeView.get(updatedSubject.name);

          if (existingSubject) {
            // If the event carried a new schemas array (already fetched), then use that, otherwise
            // just set the schemas to null to force a refresh.

            // Merge the new schemas into the subject's schemas, keeping existing in common,
            // possibly deleting some, possible adding new ones.
            existingSubject.mergeSchemas(updatedSubject.schemas);

            // Now get the treeview to realize that the subject's getChildren() will
            // be different, so it needs to repaint the subject.
            logger.debug(
              `Firing change to subject, now has ${existingSubject.schemas!.length} schemas`,
            );
            // Repaint the subject in the tree view.
            this._onDidChangeTreeData.fire(existingSubject);
          }
        }
      },
    );

    return [
      environmentChangedSub,
      ccloudConnectedSub,
      localSchemaRegistryConnectedSub,
      currentSchemaRegistryChangedSub,
      schemaSearchSetSub,
      schemaSubjectChangedSub,
      schemaVersionsChangedSub,
    ];
  }

  /**
   * Update the tree view description to show the currently-focused Schema Registry's parent env
   * name and the Schema Registry ID.
   *
   * Reassigns this.environment to the parent environment of the Schema Registry.
   * */

  async updateTreeViewDescription(): Promise<void> {
    const schemaRegistry = this.schemaRegistry;

    const subLogger = logger.withCallpoint("updateTreeViewDescription");

    if (!schemaRegistry) {
      subLogger.debug("called with no schema registry, simple short-circuit");
      this.treeView.description = "";
      this.environment = null;
      return;
    } else {
      subLogger.debug("called with schema registry");
    }

    subLogger.debug("scanning for environments ...");

    const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);
    const envs = await loader.getEnvironments();
    const parentEnv = envs.find((env) => env.id === schemaRegistry.environmentId);
    this.environment = parentEnv ?? null;
    if (parentEnv) {
      subLogger.debug("found environment.");

      this.treeView.description = `${parentEnv.name} | ${schemaRegistry.id}`;
    } else {
      subLogger.debug("couldn't find parent environment for Schema Registry");

      // Probably because the environment was deleted.
      this.treeView.description = "";
    }

    subLogger.debug("done.");
  }

  /** Try to reveal+expand schema under a subject, if present */
  async revealSchema(schemaToShow: Schema): Promise<void> {
    if (!this.schemaRegistry || this.schemaRegistry.id !== schemaToShow.schemaRegistryId) {
      // Reset what SR is being viewed.
      logger.debug(
        `revealSchema(): changing the view to look at schema registry ${schemaToShow.schemaRegistryId}`,
      );

      const loader = ResourceLoader.getInstance(schemaToShow.connectionId);
      const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(
        schemaToShow.environmentId,
      );

      if (!schemaRegistry) {
        logger.error("Strange, couldn't find schema registry for schema", {
          schemaToShow,
        });
        return;
      }

      // Update the view to show the new SR synchronously so we can guarantee
      // that this.subjectsInTreeView is populated with the subjects from the new SR.
      // and that `.schemas` of the subject soon-to-be-found within
      // `this.subjectsInTreeView` will be populated with the schemas, especially
      // the one we want to reveal by the time we get to the `.find()` and `.reveal()`
      // lines lower down.
      await this.setSchemaRegistry(schemaRegistry);
    }

    // Find the subject in the tree view's model.
    const subject = this.subjectsInTreeView.get(schemaToShow.subject);
    if (!subject) {
      logger.error("Strange, couldn't find subject for schema in tree view", {
        schemaToShow,
      });
      return;
    }

    logger.debug(
      `revealSchema(): found subject ${subject.name} for schema ${schemaToShow.id}, ${subject.schemas?.length} schemas, revealing...`,
    );

    // Ensure we have the schemas loaded for the subject and stitched in.
    // Should update `subject` in place.
    await this.updateSubjectSchemas(subject.name, null);

    logger.debug(
      `revealSchema(): After updateSubjectSchemas(), ${subject.schemas?.length} schemas.`,
    );

    // Find the equivalent schema-within-the-subject by ID. It should have been loaded already, otherwise
    // something is coded wrong before here.
    const schema = subject.schemas!.find((schema) => schema.id === schemaToShow.id);
    if (!schema) {
      logger.error(
        `Strange, found subject ${subject.name} but it did not contain the expected schema by id: ${schemaToShow.id}`,
      );
      return;
    }

    try {
      await this.treeView.reveal(schema, { focus: true, select: true });
    } catch (e) {
      logError(e, "Error revealing schema in tree view", {
        extra: { functionName: "revealSchema" },
      });
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

  /** Are we currently viewing a CCloud-based schema registry? */
  isFocusedOnCCloud(): boolean {
    return this.schemaRegistry !== null && isCCloud(this.schemaRegistry);
  }
}

/** Get the singleton instance of the {@link SchemasViewProvider} */
export function getSchemasViewProvider() {
  return SchemasViewProvider.getInstance();
}
