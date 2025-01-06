import * as vscode from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import {
  ccloudConnected,
  currentSchemaRegistryChanged,
  environmentChanged,
  localSchemaRegistryConnected,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { ContainerTreeItem } from "../models/main";
import { isCCloud, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { ResourceLoader } from "../storage/resourceLoader";

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
  /** The parent of the focused Schema Registry.  */
  public environment: Environment | null = null;
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
    this.environment = null;
    this.schemaRegistry = null;
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
      return new ContainerTreeItem<Schema>(
        element.subject,
        vscode.TreeItemCollapsibleState.Collapsed,
        [],
      );
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
      if (this.schemaRegistry != null) {
        const loader = ResourceLoader.getInstance(this.schemaRegistry.connectionId);
        const schemas =
          (await loader.getSchemasForRegistry(this.schemaRegistry, this.forceDeepRefresh)) ?? [];
        if (this.forceDeepRefresh) {
          // Just honored the user's request for a deep refresh.
          this.forceDeepRefresh = false;
        }
        // return the hierarchy of "Key/Value Schemas -> Subject -> Version" items or return empty array
        return schemas.length > 0 ? generateSchemaSubjectGroups(schemas) : [];
      }
    }

    return schemaList;
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

    return [
      environmentChangedSub,
      ccloudConnectedSub,
      localSchemaRegistryConnectedSub,
      currentSchemaRegistryChangedSub,
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

  /** Try to reveal this particular schema, if present */
  revealSchema(schema: Schema): void {
    this.treeView.reveal(schema, { focus: true, select: true, expand: true });
  }
}

/** Get the singleton instance of the {@link SchemasViewProvider} */
export function getSchemasViewProvider() {
  return SchemasViewProvider.getInstance();
}
