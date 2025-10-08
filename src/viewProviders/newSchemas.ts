import { Disposable, TreeDataProvider, TreeItem, Uri } from "vscode";
import { ContextValues } from "../context/values";
import { schemaSearchSet, schemasViewResourceChanged } from "../emitters";
import { ResourceLoader } from "../loaders";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { ParentedBaseViewProvider } from "./baseModels/parentedBase";
import { updateCollapsibleStateFromSearch } from "./utils/collapsing";
import { itemMatchesSearch, SEARCH_DECORATION_URI_SCHEME } from "./utils/search";
/**
 * The types managed by the {@link SchemasViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type SchemasViewProviderData = Subject | Schema;

export class NewSchemasViewProvider
  extends ParentedBaseViewProvider<SchemaRegistry, SchemasViewProviderData>
  implements TreeDataProvider<SchemasViewProviderData>
{
  readonly viewId: string = "confluent-schemas";

  readonly kind = "schemas";
  loggerName = "viewProviders.newSchemas";

  parentResourceChangedEmitter = schemasViewResourceChanged;
  parentResourceChangedContextValue = ContextValues.schemaRegistrySelected;

  searchContextValue = ContextValues.schemaSearchApplied;
  searchChangedEmitter = schemaSearchSet;

  // Map of subject string -> subject object currently in the tree view.
  private subjectsInTreeView: Map<string, Subject> = new Map();

  async refresh(forceDeepRefresh = false): Promise<void> {
    // Out with any existing subjects.
    this.subjectsInTreeView.clear();

    if (this.resource) {
      // Immediately inform the view that we (temporarily) have no data so it will clear.
      this._onDidChangeTreeData.fire();

      // Load subjects from the current schema registry.
      const loader = ResourceLoader.getInstance(this.resource.connectionId);
      // Capture the SR instance locally in case it changes while we're loading.
      const schemaRegistry = this.resource;

      await this.withProgress(`Loading subjects from schema registry ...`, async () => {
        const subjects = await loader.getSubjects(schemaRegistry);
        subjects.forEach((subject) => {
          this.subjectsInTreeView.set(subject.name, subject);
        }, false);
      });
    }
    // inform the view that we have new toplevel data.
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: SchemasViewProviderData): SchemasViewProviderData[] {
    if (!this.resource) {
      // no schema registry selected, so no children
      return [];
    }

    let children: SchemasViewProviderData[];

    if (!element) {
      // return the subjects at the root of the tree
      return Array.from(this.subjectsInTreeView.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }

    if (element instanceof Subject) {
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

      return this.filterChildren(element, children);
    }

    // must be a Schema, which is a leaf item with no children
    return [];
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
    await this.withProgress(`Loading ${subjectString}...`, async () => {
      this.logger.debug("updateSubjectSchemas(): Refreshing single subject in tree view", {
        subject: subjectString,
        newSchemaCount: newSchemas?.length,
      });

      if (newSchemas === null) {
        // Go get the schemas for this subject
        if (!this.resource) {
          throw new Error("No schema registry");
        }
        const loader = ResourceLoader.getInstance(this.resource.connectionId);
        newSchemas = await loader.getSchemasForSubject(this.resource, subjectString);
      }

      const subjectInMap = this.subjectsInTreeView.get(subjectString);
      if (!subjectInMap) {
        this.logger.error("Strange, couldn't find subject in tree view", { subjectString });
        return;
      }

      subjectInMap.schemas = newSchemas;

      this._onDidChangeTreeData.fire(subjectInMap);
    });
  }

  getParent(element: SchemasViewProviderData): SchemasViewProviderData | null {
    if (element instanceof Schema) {
      // if we're a schema, our parent is the schema's Subject as found in our map
      const subject = this.subjectsInTreeView.get(element.subject);
      if (!subject) {
        this.logger.error("Strange, couldn't find subject in tree view", { element });
        return null;
      }
      return subject;
    }
    // Otherwise the parent of a container tree item is the root.
    return null;
  }

  getTreeItem(element: SchemasViewProviderData): TreeItem {
    let treeItem: TreeItem;

    if (element instanceof Subject) {
      treeItem = new SubjectTreeItem(element);
    } else {
      // must be a Schema
      treeItem = new SchemaTreeItem(element);
    }

    // XXX TODO This block is extremely common, push down into BaseViewProvider
    if (this.itemSearchString) {
      if (itemMatchesSearch(element, this.itemSearchString)) {
        // special URI scheme to decorate the tree item with a dot to the right of the label,
        // and color the label, description, and decoration so it stands out in the tree view
        treeItem.resourceUri = Uri.parse(`${SEARCH_DECORATION_URI_SCHEME}:/${element.id}`);
      }
      treeItem = updateCollapsibleStateFromSearch(element, treeItem, this.itemSearchString);
    }

    return treeItem;
  }

  protected setCustomEventListeners(): Disposable[] {
    return [];
  }
}
