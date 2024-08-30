import * as vscode from "vscode";
import { Schema as ResponseSchema, SchemasV1Api } from "../clients/schemaRegistryRest";
import { currentSchemaRegistryChanged } from "../emitters";
import { CCloudEnvironment } from "../models/environment";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, SchemaType, generateSchemaSubjectGroups } from "../models/schema";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";

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

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private treeView: vscode.TreeView<SchemasViewProviderData>;
  /** The parent of the focused Schema Registry cluster, if it came from CCloud.  */
  public ccloudEnvironment: CCloudEnvironment | null = null;
  /** The focused Schema Registry cluster; set by clicking a Schema Registry item in the Resources view. */
  public schemaRegistry: SchemaRegistryCluster | null = null;

  constructor() {
    this.treeView = vscode.window.createTreeView("confluent-schemas", { treeDataProvider: this });

    currentSchemaRegistryChanged.event(async (schemaRegistry: SchemaRegistryCluster | null) => {
      if (!schemaRegistry) {
        vscode.commands.executeCommand("setContext", "confluent.schemaRegistrySelected", false);
        this.schemaRegistry = null;
        this.ccloudEnvironment = null;
        this.treeView.description = "";
      } else {
        vscode.commands.executeCommand("setContext", "confluentSchemaRegistrySelected", true);
        this.schemaRegistry = schemaRegistry;
        const environment: CCloudEnvironment | null =
          await getResourceManager().getCCloudEnvironment(this.schemaRegistry.environmentId);
        this.ccloudEnvironment = environment;
        this.treeView.description = `${this.ccloudEnvironment!.name} | ${this.schemaRegistry.id}`;
      }
      this.refresh();
    });
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
        const schemas = await getSchemas(this.ccloudEnvironment, this.schemaRegistry.id);
        // create the hierarchy of "Key/Value Schemas -> Subject -> Version" items
        return generateSchemaSubjectGroups(schemas);
      }
    }

    return schemaList;
  }
}

var schemasViewProvider = new SchemasViewProvider();
/** Get the singleton instance of the {@link SchemasViewProvider} */
export function getSchemasViewProvider() {
  return schemasViewProvider;
}

export async function getSchemas(
  environment: CCloudEnvironment,
  schemaRegistryClusterId: string,
): Promise<Schema[]> {
  const client: SchemasV1Api = (await getSidecar()).getSchemasV1Api(
    schemaRegistryClusterId,
    environment.connectionId,
  );
  const schemaListRespData: ResponseSchema[] = await client.getSchemas();
  const schemas: Schema[] = schemaListRespData.map((schema: ResponseSchema) => {
    // AVRO doesn't show up in `schemaType`
    // https://docs.confluent.io/platform/current/schema-registry/develop/api.html#get--subjects-(string-%20subject)-versions-(versionId-%20version)
    const schemaType = (schema.schemaType as SchemaType) || SchemaType.Avro;
    // casting `id` from number to string to allow returning Schema types in `.getChildren()` above
    return Schema.create({
      id: schema.id!.toString(),
      subject: schema.subject!,
      version: schema.version!,
      type: schemaType,
      schemaRegistryId: schemaRegistryClusterId,
      environmentId: environment.id,
    });
  });
  await getResourceManager().setCCloudSchemas(schemas);
  return schemas;
}
