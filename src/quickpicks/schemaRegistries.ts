import { commands, QuickPickItem, QuickPickItemKind, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { getConnectionLabel, isCCloud, isDirect, isLocal } from "../models/resource";
import { SchemaRegistry } from "../models/schemaRegistry";
import { ResourceLoader } from "../storage/resourceLoader";
import { getSchemasViewProvider } from "../viewProviders/schemas";

const logger = new Logger("quickpicks.schemaRegistry");

/** Wrapper for the Schema Registry quickpick to accomodate data-fetching time and display a progress
 * indicator on the Schemas view. */
export async function schemaRegistryQuickPickWithViewProgress(): Promise<
  SchemaRegistry | undefined
> {
  return await window.withProgress(
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
 * Create and await a quickpick to let the user choose a {@link SchemaRegistry}, separated by
 * connection type, but named by the SR parent environment (since only one SR is set per environment).
 *
 * Example:
 * ---------------------------------- Local
 * Local (local-id1)
 * ---------------------------------- Confluent Cloud
 * env1 (lsrc-id1)
 * env2 (lsrc-id2)
 * ---------------------------------- Other
 * direct-env1 (direct-sr1)
 * direct-env2 (direct-sr2)
 * direct-env3 (direct-sr3)
 */
export async function schemaRegistryQuickPick(
  defaultRegistryId: string | undefined = undefined,
): Promise<SchemaRegistry | undefined> {
  const environments: Environment[] = [];

  const schemaRegistries: SchemaRegistry[] = [];
  const registryIdMap: Map<string, SchemaRegistry> = new Map();

  // TODO: enforce ordering between CCloud loader, Local loader, and Direct loaders?
  for (const loader of ResourceLoader.loaders()) {
    const envs: Environment[] = await loader.getEnvironments();
    environments.push(...envs);
    const registries: SchemaRegistry[] = await loader.getSchemaRegistries();
    if (registries.length > 0) {
      schemaRegistries.push(...registries);
      for (const registry of registries) {
        registryIdMap.set(registry.id, registry);
      }
    }
  }

  if (schemaRegistries.length === 0) {
    let login: string = "";
    let local: string = "";
    if (!getContextValue(ContextValues.ccloudConnectionAvailable)) {
      login = "Sign in to Confluent Cloud";
    }
    if (!getContextValue(ContextValues.localSchemaRegistryAvailable)) {
      local = "Start Local Resources";
    }
    // TODO: offer button for creating a direct connection?
    window
      .showInformationMessage("No Schema registries available.", login, local)
      .then((selected) => {
        if (selected === login) {
          commands.executeCommand("confluent.connections.ccloud.signIn");
        } else if (selected === local) {
          commands.executeCommand("confluent.docker.startLocalResources");
        }
      });
    return;
  }

  logger.debug("generating Schema Registry quickpick", {
    local: schemaRegistries.filter((registry) => isLocal(registry)).length,
    ccloud: schemaRegistries.filter((registry) => isCCloud(registry)).length,
    direct: schemaRegistries.filter((registry) => isDirect(registry)).length,
  });

  // convert all available Schema Registries to quick pick items and keep track of the last env name
  // used for the separators
  const registryItems: QuickPickItem[] = [];

  // Determine the default registry to select, if any.
  // Prefer defaultRegistryId if provided, otherwise the focused registry in the schemas view, if any.
  const focusedRegistry: SchemaRegistry | null = getSchemasViewProvider().schemaRegistry;
  const defaultRegistry: SchemaRegistry | null =
    (defaultRegistryId && registryIdMap.get(defaultRegistryId)) || focusedRegistry;

  const defaultRegistryIndex: number = schemaRegistries.findIndex(
    (registry) => registry.id === defaultRegistry?.id,
  );
  if (defaultRegistryIndex !== -1) {
    schemaRegistries.splice(defaultRegistryIndex, 1);
    schemaRegistries.unshift(defaultRegistry!);
  }

  let lastSeparator: string = "";
  for (const registry of schemaRegistries) {
    const environment: Environment | undefined = environments.find(
      (env) => env.id === registry.environmentId,
    );
    if (!environment) {
      logger.warn(`No environment found for Schema Registry ${registry.id}`);
      return;
    }
    const isFocusedRegistry = focusedRegistry?.id === registry.id;

    // show a separator by connection type (not connection + env name like with Kafka clusters)
    const connectionLabel = getConnectionLabel(registry.connectionType);
    if (lastSeparator !== connectionLabel) {
      registryItems.push({
        kind: QuickPickItemKind.Separator,
        label: connectionLabel,
      });
      lastSeparator = connectionLabel;
    }

    // Brand the currently focused registry, if any
    const icon = isFocusedRegistry ? IconNames.CURRENT_RESOURCE : registry.iconName;

    // Add the registry to the quickpick
    registryItems.push({
      label: environment.name,
      description: registry.id,
      detail: defaultRegistryId === registry.id ? "Default" : undefined,
      iconPath: new ThemeIcon(icon),
    });
  }

  // Prompt the user to select a Schema Registry
  const chosenRegistryItem: QuickPickItem | undefined = await window.showQuickPick(registryItems, {
    placeHolder: "Select a Schema Registry",
    ignoreFocusOut: true,
  });

  // Return the selected SchemaRegistry model, else undefined
  return chosenRegistryItem ? registryIdMap.get(chosenRegistryItem.description!) : undefined;
}
