import * as vscode from "vscode";
import { ContextValues, getExtensionContext, setContextValue } from "../context";
import {
  ccloudConnected,
  currentSchemaRegistryChanged,
  localSchemaRegistryConnected,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { ResourceLoader, fetchSchemas } from "../storage/resourceLoader";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.schemas");

/**
 * The types managed by the {@link SchemasViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type SchemasViewProviderData = ContainerTreeItem<Schema> | Schema;

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

  /** (Re)paint the view. If forceDeepRefresh=true, then will force a deep fetch of the schemas
   * in the schema registry.
   */
  refresh(forceDeepRefresh: boolean = false): void {
    this.forceDeepRefresh = forceDeepRefresh;
    this._onDidChangeTreeData.fire();
  }

  private treeView: vscode.TreeView<SchemasViewProviderData>;
  /** The parent of the focused Schema Registry, if it came from CCloud.  */
  public ccloudEnvironment: CCloudEnvironment | null = null;
  /** The focused Schema Registry; set by clicking a Schema Registry item in the Resources view. */
  public schemaRegistry: SchemaRegistry | null = null;

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
    this.schemaRegistry = null;
    this.ccloudEnvironment = null;
    this.treeView.description = "";
    this.refresh();
  }

  // we're not handling just `Schema` here since we may be expanding a container tree item
  getTreeItem(element: SchemasViewProviderData): vscode.TreeItem | SchemaTreeItem {
    if (element instanceof Schema) {
      return new SchemaTreeItem(element);
    }
    return element;
  }

  getParent(element: SchemasViewProviderData): SchemasViewProviderData | null {
    if (element instanceof Schema) {
      // if we're a schema, our parent is (an equivalent) container tree item (that will have the right label (the schema subject))
      return { label: element.subject, children: [] };
    }
    // Otherwise the parent of a container tree item is the root.
    return null;
  }

  async getChildren(element?: SchemasViewProviderData): Promise<SchemasViewProviderData[]> {
    // we should get the following hierarchy/structure of tree items from this method:
    // - topic1-value (ContainerTreeItem)
    //   - schema1-V2 (Schema)
    //   - schema1-V1 (Schema)
    // - topic2-value (ContainerTreeItem)
    //   - schema2-V1 (Schema)

    let schemaList: SchemasViewProviderData[] = [];

    if (element) {
      if (element instanceof ContainerTreeItem) {
        return element.children;
      }
      // Schema items are leaf nodes, so we don't need to handle them here
    } else {
      // TODO(james): integrate local schema caching into the loader.
      // (James: Easier said that done, but is gonna happen.)
      if (this.schemaRegistry != null) {
        let schemas: Schema[] = [];

        if (this.ccloudEnvironment != null) {
          const loader = ResourceLoader.getInstance(this.schemaRegistry.connectionId);
          // ensure that the resources are loaded before trying to access them
          await loader.ensureCoarseResourcesLoaded();
          await loader.ensureSchemasLoaded(this.schemaRegistry.id, this.forceDeepRefresh);
          if (this.forceDeepRefresh) {
            // Just honored the user's request for a deep refresh.
            this.forceDeepRefresh = false;
          }
          schemas =
            (await getResourceManager().getSchemasForRegistry(this.schemaRegistry.id)) ?? [];
        } else {
          // fetching local Schema Registry schemas, so we don't have an environmentId to use
          try {
            schemas = await fetchSchemas(this.schemaRegistry.id, this.schemaRegistry.connectionId);
            await getResourceManager().setSchemasForRegistry(this.schemaRegistry.id, schemas);
          } catch (error) {
            logger.error("Failed to get schemas:", { error });
          }
        }
        // return the hierarchy of "Key/Value Schemas -> Subject -> Version" items or return empty array
        return schemas.length > 0 ? generateSchemaSubjectGroups(schemas) : [];
      }
    }

    return schemaList;
  }

  /** Set up event listeners for this view provider. */
  setEventListeners(): vscode.Disposable[] {
    const ccloudConnectedSub: vscode.Disposable = ccloudConnected.event((connected: boolean) => {
      if (this.schemaRegistry?.isCCloud) {
        logger.debug("ccloudConnected event fired, resetting", { connected });
        // any transition of CCloud connection state should reset the tree view
        this.reset();
      }
    });

    const localSchemaRegistryConnectedSub: vscode.Disposable = localSchemaRegistryConnected.event(
      (connected: boolean) => {
        if (this.schemaRegistry?.isLocal) {
          logger.debug("localSchemaRegistryConnected event fired, resetting", { connected });
          // any transition of local schema registry connection state should reset the tree view
          this.reset();
        }
      },
    );

    const currentSchemaRegistryChangedSub: vscode.Disposable = currentSchemaRegistryChanged.event(
      async (schemaRegistry: SchemaRegistry | null) => {
        if (!schemaRegistry) {
          this.reset();
        } else {
          setContextValue(ContextValues.schemaRegistrySelected, true);
          this.schemaRegistry = schemaRegistry;
          // update the tree view title to show the currently focused Schema Registry and repopulate the tree
          if (this.schemaRegistry.isLocal) {
            // just show "Local" since we don't have a name for the local SR instance
            this.treeView.description = "Local";
          } else {
            const environment: CCloudEnvironment | null =
              await getResourceManager().getCCloudEnvironment(
                (this.schemaRegistry as CCloudSchemaRegistry).environmentId,
              );
            this.ccloudEnvironment = environment;
            this.treeView.description = `${this.ccloudEnvironment!.name} | ${this.schemaRegistry.id}`;
          }
          this.refresh();
        }
      },
    );

    return [ccloudConnectedSub, localSchemaRegistryConnectedSub, currentSchemaRegistryChangedSub];
  }

  /** Deep refesh + repaint the view if it is showing the given registry. Otherwise, hint
   * the preloader to purge the cache for this schema registry (if currently cached), so that next
   * time it is shown, it will be deep-fetched.
   */
  refreshIfShowingRegistry(schemaRegistry: SchemaRegistry): void {
    // if the schema registry is the one being shown, deep refresh the view
    if (this.schemaRegistry?.id === schemaRegistry.id) {
      this.refresh(true);
    } else {
      // Otherwise at least inform the resource loader to purge the cache for this schema registry
      // (if currently cached).
      const loader = ResourceLoader.getInstance(schemaRegistry.connectionId);
      loader.purgeSchemas(schemaRegistry.id);
    }
  }

  /** Try to reveal this particular schema, if present */
  revealSchema(schema: Schema): void {
    this.treeView.reveal(schema, { focus: true, select: true, expand: true });
  }
}

/** Get the singleton instance of the {@link SchemasViewProvider} */
export function getSchemasViewProvider() {
  return SchemasViewProvider.getInstance();
}
