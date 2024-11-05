import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getLocalResources, LocalResourceGroup } from "../graphql/local";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import {
  CCloudSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
} from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections";
import { CCloudResourcePreloader } from "../storage/ccloudPreloader";
import { CCloudSchemaRegistryByEnv, getResourceManager } from "../storage/resourceManager";
import { getSchemasViewProvider } from "../viewProviders/schemas";

const logger = new Logger("quickpicks.schemaRegistry");

/** Wrapper for the Schema Registry quickpick to accomodate data-fetching time and display a progress
 * indicator on the Schemas view. */
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
 * Create a quickpick to let the user choose a Schema Registry, named by environment.
 *
 * @returns The selected Schema Registry, or undefined if none was selected.
 */
export async function schemaRegistryQuickPick(): Promise<SchemaRegistry | undefined> {
  const localSchemaRegistries: LocalSchemaRegistry[] = [];
  let cloudSchemaRegistries: CCloudSchemaRegistry[] = [];

  // schema registries are a coarse resource, so ensure they are loaded before proceeding
  const preloader = CCloudResourcePreloader.getInstance();
  await preloader.ensureCoarseResourcesLoaded();

  // first we grab all available (local+CCloud) Schema Registries
  let localGroups: LocalResourceGroup[] = [];
  let cloudGroups: CCloudSchemaRegistryByEnv | null = new Map<string, CCloudSchemaRegistry>();
  [localGroups, cloudGroups] = await Promise.all([
    getLocalResources(),
    getResourceManager().getCCloudSchemaRegistries(),
  ]);
  localGroups.forEach((group) => {
    if (group.schemaRegistry) {
      localSchemaRegistries.push(group.schemaRegistry);
    }
  });

  // list all Schema Registries for all CCloud environments for the given connection; to be separated
  // further by environment in the quickpick menu below
  let cloudEnvironmentIds: string[] = [];
  if (hasCCloudAuthSession()) {
    cloudGroups.forEach((schemaRegistry, envId) => {
      cloudEnvironmentIds.push(envId);
      cloudSchemaRegistries.push(schemaRegistry);
    });
  }

  let availableSchemaRegistries: SchemaRegistry[] = [];
  availableSchemaRegistries.push(...localSchemaRegistries, ...cloudSchemaRegistries);
  if (availableSchemaRegistries.length === 0) {
    vscode.window.showInformationMessage("No Schema Registries available.");
    if (!hasCCloudAuthSession()) {
      const login = "Log in to Confluent Cloud";
      vscode.window
        .showInformationMessage("Connect to Confluent Cloud to access remote clusters.", login)
        .then((selected) => {
          if (selected === login) {
            vscode.commands.executeCommand("confluent.connections.create");
          }
        });
    }
    return undefined;
  }

  // Is there a selected Schema Registry already focused in the Schemas view?
  const selectedSchemaRegistry: SchemaRegistry | null = getSchemasViewProvider().schemaRegistry;

  // convert all available Schema Registries to quick pick items
  let quickPickItems: vscode.QuickPickItem[] = [];
  // and map the SR URI to the Schema Registries themselves since we need to pass the ID
  // through to follow-on commands, but users will be more familiar with the names
  // (for ease of looking up both local & CCloud clusters, we're using `name:id` as the key format
  // that will match the label:description format of the quick pick items below)
  const schemaRegistryNameMap: Map<string, SchemaRegistry> = new Map();

  if (localSchemaRegistries.length > 0) {
    // add a single separator
    quickPickItems.push({
      kind: vscode.QuickPickItemKind.Separator,
      label: "Local",
    });
  }
  localSchemaRegistries.forEach((schemaRegistry: LocalSchemaRegistry) => {
    quickPickItems.push({
      label: schemaRegistry.uri,
      description: schemaRegistry.id,
      iconPath:
        selectedSchemaRegistry?.id === schemaRegistry.id
          ? new vscode.ThemeIcon(IconNames.CURRENT_RESOURCE)
          : new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY),
    });
    schemaRegistryNameMap.set(schemaRegistry.uri, schemaRegistry);
  });

  // make a map of all environment IDs to environments for easy lookup below
  const environmentMap: Map<string, CCloudEnvironment> = new Map();
  const cloudEnvironments: CCloudEnvironment[] = await getResourceManager().getCCloudEnvironments();
  cloudEnvironments.forEach((env) => {
    environmentMap.set(env.id, env);
  });

  // sort the Schema Registries by (is the selected one, environment name)
  cloudSchemaRegistries.sort((a, b) => {
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
  logger.debug(`Found ${cloudEnvironmentIds.length} environments`);

  if (cloudSchemaRegistries.length > 0) {
    // show a top-level separator for CCloud Schema Registries (unlike the Kafka cluster quickpick,
    // we don't need to split by CCloud environments since each Schema Registry is tied to a single
    // environment)
    quickPickItems.push({
      kind: vscode.QuickPickItemKind.Separator,
      label: `Confluent Cloud`,
    });
  }
  cloudSchemaRegistries.forEach((schemaRegistry: CCloudSchemaRegistry) => {
    const environment: CCloudEnvironment | undefined = environmentMap.get(
      schemaRegistry.environmentId,
    );
    if (!environment) {
      logger.warn(
        `No environment found for Schema Registry envId "${schemaRegistry.environmentId}"`,
      );
      return;
    }
    quickPickItems.push({
      label: environment.name,
      description: schemaRegistry.id,
      iconPath: new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY),
    });
    schemaRegistryNameMap.set(environment.name, schemaRegistry);
  });

  // prompt the user to select a Schema Registry
  const chosenSchemaRegistry: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    quickPickItems,
    {
      placeHolder: "Select a Schema Registry",
      ignoreFocusOut: true,
    },
  );
  return chosenSchemaRegistry ? schemaRegistryNameMap.get(chosenSchemaRegistry.label) : undefined;
}
