import * as vscode from "vscode";
import { IconNames } from "../constants";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections";
import { CCloudResourcePreloader } from "../storage/ccloudPreloader";
import { getResourceManager } from "../storage/resourceManager";
import { getSchemasViewProvider } from "../viewProviders/schemas";

const logger = new Logger("quickpicks.schemaRegistry");

/**
 * Runs the schemaRegistryQuickPick with a view progress indicator
 * on the schemas view.
 */
export async function schemaRegistryQuickPickWithViewProgress(): Promise<
  SchemaRegistry | undefined
> {
  return await vscode.window.withProgress(
    {
      location: { viewId: "confluent-schemas" },
      title: "Loading Schema Registries...",
    },
    async () => {
      return await schemaRegistryQuickPick();
    },
  );
}

/**
 * Create a quickpick to let the user choose a Schema Registry (listed by CCloud environment
 * separators). Mainly used in the event a command was triggered through the command palette instead
 * of through the view->item->context menu.
 *
 * @returns The selected Schema Registry, or undefined if none was selected.
 */
export async function schemaRegistryQuickPick(): Promise<SchemaRegistry | undefined> {
  // TODO(shoup): update to support LocalSchemaRegistry

  // schema registries are a coarse resource, so ensure they are loaded before proceeding
  const preloader = CCloudResourcePreloader.getInstance();
  await preloader.ensureCoarseResourcesLoaded();

  // list all Schema Registries for all CCloud environments for the given connection; to be
  // separated further by environment in the quickpick menu below
  const resourceManager = getResourceManager();
  const ccloudSchemaRegistries = Array.from(
    (await resourceManager.getCCloudSchemaRegistries()).values(),
  );

  if (ccloudSchemaRegistries.length === 0) {
    let message = "No Schema Registries available.";

    if (!hasCCloudAuthSession()) {
      message += " Perhaps log into to Confluent Cloud first?";
    }
    const login = "Log in to Confluent Cloud";
    const selected = await vscode.window.showInformationMessage(message, login);
    if (selected === login) {
      vscode.commands.executeCommand("confluent.connections.create");
    }
    return undefined;
  }

  // make a map of all environment IDs to environments for easy lookup below
  const environmentMap: Map<string, CCloudEnvironment> = new Map();
  const environments: CCloudEnvironment[] = await getResourceManager().getCCloudEnvironments();
  environments.forEach((env: CCloudEnvironment) => {
    environmentMap.set(env.id, env);
  });

  // Is there a selected schema registry already in the view?
  const selectedSchemaRegistry: SchemaRegistry | null = getSchemasViewProvider().schemaRegistry;

  // sort the Schema Registries by (is the selected one, environment name)
  ccloudSchemaRegistries.sort((a, b) => {
    if (selectedSchemaRegistry) {
      if (a.id === selectedSchemaRegistry.id) {
        return -1;
      }
      if (b.id === selectedSchemaRegistry.id) {
        return 1;
      }
    }
    const aEnvName = environmentMap.get(a.environmentId)!.name;
    const bEnvName = environmentMap.get(b.environmentId)!.name;
    return aEnvName!.localeCompare(bEnvName!);
  });

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
      picked: selectedSchemaRegistry ? selectedSchemaRegistry.id === registry.id : false,
    });
    schemaRegistryMap.set(registry.id, registry);
  });

  logger.info(`Found ${schemaRegistryItems.length - 1} Schema Registries, asking user to pick one`);

  // TODO(shoup): update to support LocalSchemaRegistry
  const selectedSchemaRegistryItem: vscode.QuickPickItem | undefined =
    await vscode.window.showQuickPick(schemaRegistryItems, {
      placeHolder: "Select a Schema Registry by Environment",
    });

  return selectedSchemaRegistryItem
    ? schemaRegistryMap.get(selectedSchemaRegistryItem.description!)
    : undefined;
}
