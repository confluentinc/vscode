import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getEnvironments } from "../graphql/environments";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("quickpicks.schemaRegistry");

/** Progress wrapper for the Schema Registry quickpick to accomodate data-fetching time. */
export async function schemaRegistryQuickPick(): Promise<SchemaRegistry | undefined> {
  return await vscode.window.withProgress(
    {
      location: { viewId: "confluent-schemas" },
      title: "Loading Schema Registries...",
    },
    async () => {
      return await generateSchemaRegistryQuickPick();
    },
  );
}

/**
 * Create a quickpick to let the user choose a Schema Registry (listed by CCloud environment
 * separators). Mainly used in the event a command was triggered through the command palette instead
 * of through the view->item->context menu.
 */
async function generateSchemaRegistryQuickPick(): Promise<SchemaRegistry | undefined> {
  // TODO(shoup): update to support LocalSchemaRegistry
  if (!hasCCloudAuthSession()) {
    return undefined;
  }
  // list all Schema Registries for all CCloud environments for the given connection; to be
  // separated further by environment in the quickpick menu below
  const envGroups = await getEnvironments();
  const ccloudSchemaRegistries: CCloudSchemaRegistry[] = envGroups
    .map((group) => group.schemaRegistry)
    .filter((registry) => registry !== undefined) as CCloudSchemaRegistry[];
  if (ccloudSchemaRegistries.length === 0) {
    vscode.window.showInformationMessage("No Schema Registries available.");
    return undefined;
  }

  // make a map of all environment IDs to environments for easy lookup below
  const environmentMap: Map<string, CCloudEnvironment> = new Map();
  const environments: CCloudEnvironment[] = await getResourceManager().getCCloudEnvironments();
  environments.forEach((env: CCloudEnvironment) => {
    environmentMap.set(env.id, env);
  });
  logger.debug(`Found ${environments.length} environments`);

  const schemaRegistryItems: vscode.QuickPickItem[] = [
    {
      kind: vscode.QuickPickItemKind.Separator,
      label: "Confluent Cloud",
    },
  ];
  const schemaRegistryMap: Map<string, CCloudSchemaRegistry> = new Map();
  ccloudSchemaRegistries.forEach((registry: CCloudSchemaRegistry) => {
    const environment: CCloudEnvironment | undefined = environmentMap.get(registry.environmentId);
    if (!environment) {
      logger.warn(`No environment found for Schema Registry ${registry.id}`);
      return;
    }
    schemaRegistryItems.push({
      label: environment.name,
      description: registry.id,
      iconPath: new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY),
    });
    schemaRegistryMap.set(registry.id, registry);
  });

  // TODO(shoup): update to support LocalSchemaRegistry
  const selectedSchemaRegistryItem: vscode.QuickPickItem | undefined =
    await vscode.window.showQuickPick(schemaRegistryItems, {
      placeHolder: "Select a Schema Registry by Environment",
    });

  return selectedSchemaRegistryItem
    ? schemaRegistryMap.get(selectedSchemaRegistryItem.description!)
    : undefined;
}
