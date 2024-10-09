import * as vscode from "vscode";
import { ContextValues, getExtensionContext, setContextValue } from "../context";
import { ccloudConnected, currentSchemaRegistryChanged } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
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

    ccloudConnected.event((connected: boolean) => {
      // TODO(shoup): check this for CCloud vs local once we start supporting local SR; check the
      // TopicViewProvider for a similar check
      logger.debug("ccloudConnected event fired, resetting", { connected });
      // any transition of CCloud connection state should reset the tree view
      this.reset();
    });

    currentSchemaRegistryChanged.event(async (schemaRegistry: SchemaRegistry | null) => {
      if (!schemaRegistry) {
        this.reset();
      } else {
        setContextValue(ContextValues.schemaRegistrySelected, true);
        this.schemaRegistry = schemaRegistry;
        const environment: CCloudEnvironment | null =
          await getResourceManager().getCCloudEnvironment(this.schemaRegistry.environmentId);
        this.ccloudEnvironment = environment;
        this.treeView.description = `${this.ccloudEnvironment!.name} | ${this.schemaRegistry.id}`;
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
