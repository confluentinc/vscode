import * as vscode from "vscode";
import { ContextValues, getExtensionContext, setContextValue } from "../context";
import { ccloudConnected, currentSchemaRegistryChanged } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { CCloudResourcePreloader } from "../storage/ccloudPreloader";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.schemas");

/**
 * The types managed by the {@link SchemasViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type SchemasViewProviderData = ContainerTreeItem<Schema> | Schema;

export class SchemasViewProvider implements vscode.TreeDataProvider<SchemasViewProviderData> {
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

  /** Deep refesh + repaint the view if it is showing the given registry id. Otherwise, hint
   * the preloader to purge the cache for this schema registry (if currently cached), so that next
   * time it is shown, it will be deep-fetched.
   */
  refreshIfShowingRegistry(schemaRegistryId: string): void {
    // if the schema registry is the one being shown, deep refresh the view
    if (this.schemaRegistry?.id === schemaRegistryId) {
      this.refresh(true);
    } else {
      // Otherwise at least inform the preloader to purge the cache for this schema registry
      // (if currently cached).
      const preloader = CCloudResourcePreloader.getInstance();
      preloader.purgeSchemas(schemaRegistryId);
    }
  }

  /** Try to reveal this particular schema, if present */
  revealSchema(schema: Schema): void {
    this.treeView.reveal(schema, { focus: true, select: true, expand: true });
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

    ccloudConnected.event((connected: boolean) => {
      if (this.schemaRegistry?.isCCloud) {
        logger.debug("ccloudConnected event fired, resetting", { connected });
        // any transition of CCloud connection state should reset the tree view
        this.reset();
      }
    });

    // TODO(shoup): check localKafkaConnected and reset this view if local SR availability changes

    currentSchemaRegistryChanged.event(async (schemaRegistry: SchemaRegistry | null) => {
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
    });
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
    // Value Schemas (ContainerTreeItem)
    // - topic1-value (ContainerTreeItem)
    //   - schema1-V2 (Schema)
    //   - schema1-V1 (Schema)
    // - topic2-value (ContainerTreeItem)
    //   - schema2-V1 (Schema)
    // Key Schemas (ContainerTreeItem)
    //   ( same as above but with "-key" subject suffixes )

    let schemaList: SchemasViewProviderData[] = [];

    if (element) {
      if (element instanceof ContainerTreeItem) {
        return element.children;
      }
      // Schema items are leaf nodes, so we don't need to handle them here
    } else {
      if (this.ccloudEnvironment != null && this.schemaRegistry != null) {
        const preloader = CCloudResourcePreloader.getInstance();
        // ensure that the resources are loaded before trying to access them
        await preloader.ensureCoarseResourcesLoaded();
        await preloader.ensureSchemasLoaded(this.schemaRegistry.id, this.forceDeepRefresh);

        if (this.forceDeepRefresh) {
          // Just honored the user's request for a deep refresh.
          this.forceDeepRefresh = false;
        }

        const schemas = await getResourceManager().getSchemasForRegistry(this.schemaRegistry.id);

        // will be undefined if the schema registry's schemas aren't in the cache (deep refresh of this one TODO?)
        // if (schemas === undefined) {
        // deep-read the schemas, put into resource manager.

        if (!schemas || schemas.length === 0) {
          // no schemas to display
          return [];
        }
        // create the hierarchy of "Key/Value Schemas -> Subject -> Version" items
        return generateSchemaSubjectGroups(schemas);
      }
    }

    return schemaList;
  }
}

/** Get the singleton instance of the {@link SchemasViewProvider} */
export function getSchemasViewProvider() {
  return SchemasViewProvider.getInstance();
}
