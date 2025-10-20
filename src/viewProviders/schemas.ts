import type { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import type {
  EnvironmentChangeEvent,
  SchemaVersionChangeEvent,
  SubjectChangeEvent,
} from "../emitters";
import {
  environmentChanged,
  localSchemaRegistryConnected,
  schemaSearchSet,
  schemaSubjectChanged,
  schemasViewResourceChanged,
  schemaVersionsChanged,
} from "../emitters";
import { logError } from "../errors";
import { ResourceLoader } from "../loaders";
import { isCCloud, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import type { SchemaRegistry } from "../models/schemaRegistry";
import { ParentedBaseViewProvider } from "./baseModels/parentedBase";
/**
 * The types managed by the {@link SchemasViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type SchemasViewProviderData = Subject | Schema;

export class SchemasViewProvider
  extends ParentedBaseViewProvider<SchemaRegistry, SchemasViewProviderData>
  implements TreeDataProvider<SchemasViewProviderData>
{
  readonly viewId: string = "confluent-schemas";

  readonly kind = "schemas";
  loggerName = "viewProviders.schemas";

  parentResourceChangedEmitter = schemasViewResourceChanged;
  parentResourceChangedContextValue = ContextValues.schemaRegistrySelected;

  searchContextValue = ContextValues.schemaSearchApplied;
  searchChangedEmitter = schemaSearchSet;

  // Map of subject string -> subject object currently in the tree view.
  private subjectsInTreeView: Map<string, Subject> = new Map();

  /** Project the current selected schema registry (if any) under backwards-compatible name. */
  get schemaRegistry(): SchemaRegistry | null {
    return this.resource;
  }

  /** Legacy attribute setter. */
  set schemaRegistry(schemaRegistry: SchemaRegistry | null) {
    this.resource = schemaRegistry;
  }

  /**
   * (Re)paint the view. If forceDeepRefresh=true, then will force a deep fetch of the schemas
   * in the schema registry.
   */
  async refresh(forceDeepRefresh: boolean = false): Promise<void> {
    if (!this.resource) {
      return;
    }

    // Capture the SR instance locally in case it changes before the
    // async withProgress() call is run.
    const schemaRegistry = this.resource;

    await this.withProgress("Loading subjects...", async () => {
      // Out with any existing subjects.
      this.subjectsInTreeView.clear();

      // Immediately inform the view that we (temporarily) have no data so it will clear.
      this._onDidChangeTreeData.fire();

      // Load subjects from the current schema registry.
      const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);

      const subjects = await loader.getSubjects(schemaRegistry, forceDeepRefresh);

      subjects.forEach((subject) => {
        this.subjectsInTreeView.set(subject.name, subject);
      });

      // Indicate to view that toplevel items have changed.
      this._onDidChangeTreeData.fire();
    });
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

  getTreeItem(element: SchemasViewProviderData): TreeItem {
    let treeItem: TreeItem;

    if (element instanceof Subject) {
      treeItem = new SubjectTreeItem(element);
    } else {
      // must be a Schema
      treeItem = new SchemaTreeItem(element);
    }

    this.adjustTreeItemForSearch(element, treeItem, true);

    return treeItem;
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

  getChildren(element?: SchemasViewProviderData): SchemasViewProviderData[] {
    // we should get the following hierarchy/structure of tree items from this method:
    // - topic1-value (Subject w/o schemas fetched preemptively)
    //   - schema1-V2 (Schema) (once the Subject is expanded)
    //   - schema1-V1 (Schema) (once the Subject is expanded)
    // - topic2-value (Subject w/o schemas fetched preemptively)
    //   - schema2-V1 (Schema) (once the Subject is expanded)
    //
    // Once the user has asked to expand a Subject, we'll on-demand fetch the Schema[] for
    // just that single Subject and return them as the children of the Subject.

    if (!this.resource) {
      // no schema registry selected, so no children
      return [];
    }

    let children: SchemasViewProviderData[];

    if (!element) {
      children = Array.from(this.subjectsInTreeView.values());
    } else if (element instanceof Subject) {
      // be sure to be using subject as found in subjectsInTreeView.
      element = this.subjectsInTreeView.get(element.name);
      if (!element) {
        return [];
      }
      if (element.schemas) {
        // Already fetched the schemas for this subject. Will at worst be an empty array.
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
      // must be a Schema, which is a leaf item with no children
      children = [];
    }

    return this.filterChildren(element, children);
  }

  protected setCustomEventListeners(): Disposable[] {
    return [
      environmentChanged.event(this.environmentChangedHandler.bind(this)),
      localSchemaRegistryConnected.event(this.localSchemaRegistryConnectedHandler.bind(this)),
      schemaSubjectChanged.event(this.schemaSubjectChangedHandler.bind(this)),
      schemaVersionsChanged.event(this.schemaVersionsChangedHandler.bind(this)),
    ];
  }

  /** Handler for when the user has modified an environment. */
  async environmentChangedHandler(envEvent: EnvironmentChangeEvent): Promise<void> {
    if (this.schemaRegistry && this.schemaRegistry.environmentId === envEvent.id) {
      if (!envEvent.wasDeleted) {
        this.logger.debug(
          "environmentChanged event fired with matching SR env ID, updating view description",
          {
            envEvent,
          },
        );
        await this.updateTreeViewDescription();
        await this.refresh();
      } else {
        this.logger.debug(
          "environmentChanged deletion event fired with matching SR env ID, resetting view",
          {
            envEvent,
          },
        );
        // environment was deleted, reset the view
        await this.reset();
      }
    }
  }

  /** Handler for when the local connection's schema registry appears or disappears. */
  async localSchemaRegistryConnectedHandler(connected: boolean): Promise<void> {
    if (this.resource && isLocal(this.resource)) {
      this.logger.debug(
        "localSchemaRegistryConnected event fired while set to local SR, resetting",
        {
          connected,
        },
      );
      // any transition of local schema registry connection state should reset the tree view
      await this.reset();
    }
  }

  /** Handler for event firing when a schema registry *subject* has been created or deleted */
  async schemaSubjectChangedHandler(event: SubjectChangeEvent): Promise<void> {
    // A subject was added or deleted. Refresh toplevel view if we're looking at
    // the same schema registry.
    const [subject, change] = [event.subject, event.change];

    if (this.resource?.id === subject.schemaRegistryId) {
      this.logger.debug(`A subject ${change} in the registry being viewed, refreshing toplevel`, {
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
      await this.refresh();
    }
  }

  /**
   * A schema version was added or removed, but the subject remains and has
   * at least one schema version.
   */
  async schemaVersionsChangedHandler(event: SchemaVersionChangeEvent): Promise<void> {
    // A schema version was added or deleted. Refresh the subject if we're looking at
    // the same schema registry.
    const [updatedSubject, change] = [event.subject, event.change];
    if (this.resource?.id === updatedSubject.schemaRegistryId) {
      this.logger.debug(
        `A schema version ${change} in the registry being viewed, refreshing subject`,
        {
          subject: updatedSubject.name,
        },
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
        this.logger.debug(
          `Firing change to subject, now has ${existingSubject.schemas!.length} schemas`,
        );
        // Repaint the subject in the tree view.
        this._onDidChangeTreeData.fire(existingSubject);
      }
    }
  }

  /** Try to reveal+expand schema under a subject, if present */
  async revealSchema(schemaToShow: Schema): Promise<void> {
    if (!this.resource || this.resource.id !== schemaToShow.schemaRegistryId) {
      // Reset what SR is being viewed.
      this.logger.debug(
        `revealSchema(): changing the view to look at schema registry ${schemaToShow.schemaRegistryId}`,
      );

      const loader = ResourceLoader.getInstance(schemaToShow.connectionId);
      const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(
        schemaToShow.environmentId!,
      );

      if (!schemaRegistry) {
        this.logger.error("Strange, couldn't find schema registry for schema", {
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
      await this.setParentResource(schemaRegistry);
    }

    // Find the subject in the tree view's model.
    const subject = this.subjectsInTreeView.get(schemaToShow.subject);
    if (!subject) {
      this.logger.error("Strange, couldn't find subject for schema in tree view", {
        schemaToShow,
      });
      return;
    }

    this.logger.debug(
      `revealSchema(): found subject ${subject.name} for schema ${schemaToShow.id}, ${subject.schemas?.length} schemas, revealing...`,
    );

    // Ensure we have the schemas loaded for the subject and stitched in.
    // Should update `subject` in place.
    await this.updateSubjectSchemas(subject.name, null);

    this.logger.debug(
      `revealSchema(): After updateSubjectSchemas(), ${subject.schemas?.length} schemas.`,
    );

    // Find the equivalent schema-within-the-subject by ID. It should have been loaded already, otherwise
    // something is coded wrong before here.
    const schema = subject.schemas!.find((schema) => schema.id === schemaToShow.id);
    if (!schema) {
      this.logger.error(
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

  /** Are we currently viewing a CCloud-based schema registry? */
  isFocusedOnCCloud(): boolean {
    return (this.resource && isCCloud(this.resource)) || false;
  }
}

/** Get the singleton instance of the {@link SchemasViewProvider} */
export function getSchemasViewProvider() {
  return SchemasViewProvider.getInstance();
}
