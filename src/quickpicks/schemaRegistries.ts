import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import {
  CCloudSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
} from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections";
import { ResourceLoader } from "../storage/resourceLoader";
import { getResourceManager } from "../storage/resourceManager";
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
 * Execute a quickpick to let the user choose a Schema Registry, named by (ccloud or local) environment.
 * If the user has selected a schema registry in the schemas view, it will be the default selection.
 *
 * @returns The selected Schema Registry, or undefined if none was selected.
 */
export async function schemaRegistryQuickPick(
  defaultRegistryId: string | undefined = undefined,
  includeLocal: boolean = true,
): Promise<SchemaRegistry | undefined> {
  const registriesByConnectionID: Map<string, SchemaRegistry[]> =
    await getRegistriesByConnectionID();

  const localSchemaRegistries: LocalSchemaRegistry[] = registriesByConnectionID.get(
    LOCAL_CONNECTION_ID,
  )! as LocalSchemaRegistry[];
  const ccloudSchemaRegistries: CCloudSchemaRegistry[] = registriesByConnectionID.get(
    CCLOUD_CONNECTION_ID,
  )! as CCloudSchemaRegistry[];

  let allSchemaRegistries: SchemaRegistry[] = [];
  allSchemaRegistries.push(...localSchemaRegistries, ...ccloudSchemaRegistries);
  if (allSchemaRegistries.length === 0) {
    let login: string = "";
    let local: string = "";

    if (!hasCCloudAuthSession()) {
      login = "Log in to Confluent Cloud";
    }
    if (includeLocal) {
      local = "Start Local Resources.";
    }

    vscode.window
      .showInformationMessage("No Schema Registries available.", login, local)
      .then((selected) => {
        if (selected === login) {
          vscode.commands.executeCommand("confluent.connections.create");
        } else if (selected === local) {
          vscode.commands.executeCommand("confluent.docker.startLocalResources");
        }
      });
    return undefined;
  } else {
    logger.debug(
      `Generating schema registry quickpick with ${localSchemaRegistries.length} local and ${ccloudSchemaRegistries.length} ccloud schema registries.`,
    );
  }

  // Determine the default to select, if any. First err on side of the SR with the default environment ID,
  // otherwise see if the schemas view provider has a selected schema registry.
  let selectedSchemaRegistry: SchemaRegistry | undefined;
  if (defaultRegistryId) {
    selectedSchemaRegistry = allSchemaRegistries.find((sr) => sr.id === defaultRegistryId);
  }
  if (!selectedSchemaRegistry) {
    selectedSchemaRegistry = getSchemasViewProvider().schemaRegistry;
  }
  logger.info(`Defaulting to schema registry with ID ${defaultRegistryId}`, {
    selectedSchemaRegistry,
  });

  // convert all available Schema Registries to quick pick items
  const quickPickItems: vscode.QuickPickItem[] = [];

  /** Map of the quickpick labels to the original schema registry so that we can return a SchemaRegistry. */
  const labelToSchemaRegistry: Map<string, SchemaRegistry> = new Map();

  const localQuickPickItems: vscode.QuickPickItem[] = [];
  // Populate quickPickItems, schemaRegistryNameMap with the local Schema Registry + the possible selected registry.
  if (localSchemaRegistries.length > 0) {
    populateLocalSchemaRegistries(
      localSchemaRegistries,
      selectedSchemaRegistry,
      localQuickPickItems,
      labelToSchemaRegistry,
    );
  }

  // Likewise with the CCloud Schema Registries.
  const ccloudQuickPickItems: vscode.QuickPickItem[] = [];
  if (ccloudSchemaRegistries.length > 0) {
    await populateCCloudSchemaRegistries(
      ccloudSchemaRegistries,
      selectedSchemaRegistry,
      ccloudQuickPickItems,
      labelToSchemaRegistry,
    );
  }

  // Add the local and CCloud Schema Registries to the quick pick items, in order based on which
  // one has the selected schema registry.
  if (selectedSchemaRegistry?.isLocal) {
    quickPickItems.push(...localQuickPickItems, ...ccloudQuickPickItems);
  } else {
    quickPickItems.push(...ccloudQuickPickItems, ...localQuickPickItems);
  }

  // prompt the user to select a Schema Registry
  const chosenSchemaRegistry: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    quickPickItems,
    {
      placeHolder: "Select a Schema Registry",
      ignoreFocusOut: true,
    },
  );
  return chosenSchemaRegistry ? labelToSchemaRegistry.get(chosenSchemaRegistry.label) : undefined;
}

/** Collect all of the schema registeries by the connection id (ccloud, local, etc.) */
async function getRegistriesByConnectionID(): Promise<Map<string, SchemaRegistry[]>> {
  const localLoader = ResourceLoader.getInstance(LOCAL_CONNECTION_ID);
  const ccloudLoader = ResourceLoader.getInstance(CCLOUD_CONNECTION_ID);

  // Get all possible Schema Registries: local and CCloud.
  const [localRegistries, ccloudRegistries] = await Promise.all([
    localLoader.getSchemaRegistries(),
    ccloudLoader.getSchemaRegistries(),
  ]);

  const registriesByConnectionID: Map<string, SchemaRegistry[]> = new Map();
  registriesByConnectionID.set(LOCAL_CONNECTION_ID, localRegistries);
  registriesByConnectionID.set(CCLOUD_CONNECTION_ID, ccloudRegistries);
  return registriesByConnectionID;
}

/** Populate the quick pick items with the local Schema Registries.
 * The `description` of each pushed QuickPickItem is the Schema Registry ID.
 */
function populateLocalSchemaRegistries(
  localSchemaRegistries: LocalSchemaRegistry[],
  selectedSchemaRegistry: SchemaRegistry | undefined,
  quickPickItems: vscode.QuickPickItem[],
  schemaRegistryNameMap: Map<string, SchemaRegistry>,
): void {
  // add a single separator
  quickPickItems.push({
    kind: vscode.QuickPickItemKind.Separator,
    label: "Local",
  });

  // Will most likely be a single local Schema Registry, but the API is designed to support multiple.
  localSchemaRegistries.forEach((schemaRegistry: SchemaRegistry) => {
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
}

/** Populate quickPickItems, schemaRegistryNameMap given CCloud Schema Registries + the current selected one, if any.
 *  The `description` of each pushed QuickPickItem is the Schema Registry ID.
 */
async function populateCCloudSchemaRegistries(
  ccloudSchemaRegistries: CCloudSchemaRegistry[],
  selectedSchemaRegistry: SchemaRegistry | undefined,
  quickPickItems: vscode.QuickPickItem[],
  schemaRegistryNameMap: Map<string, SchemaRegistry>,
): Promise<void> {
  // make a map of all environment IDs to environments for easy lookup below
  const environmentMap: Map<string, CCloudEnvironment> = new Map();
  // XXX TODO needs loader API to do this.
  const cloudEnvironments: CCloudEnvironment[] = await getResourceManager().getCCloudEnvironments();
  cloudEnvironments.forEach((env) => {
    environmentMap.set(env.id, env);
  });

  // sort the Schema Registries by the env name. Prefer to show the selected one first, then sort by env name.
  ccloudSchemaRegistries.sort((a, b) => {
    if (selectedSchemaRegistry?.id === a.id) {
      return -1;
    } else if (selectedSchemaRegistry?.id === b.id) {
      return 1;
    }
    const envA: CCloudEnvironment | undefined = environmentMap.get(a.environmentId);
    const envB: CCloudEnvironment | undefined = environmentMap.get(b.environmentId);
    return envA!.name.localeCompare(envB!.name);
  });

  // show a top-level separator for CCloud Schema Registries (unlike the Kafka cluster quickpick,
  // we don't need to split by CCloud environments since each Schema Registry is tied to a single
  // environment)
  quickPickItems.push({
    kind: vscode.QuickPickItemKind.Separator,
    label: `Confluent Cloud`,
  });

  ccloudSchemaRegistries.forEach((schemaRegistry: CCloudSchemaRegistry) => {
    const environment: CCloudEnvironment | undefined = environmentMap.get(
      schemaRegistry.environmentId,
    )!;
    quickPickItems.push({
      label: environment.name,
      description: schemaRegistry.id,
      iconPath:
        selectedSchemaRegistry?.id === schemaRegistry.id
          ? new vscode.ThemeIcon(IconNames.CURRENT_RESOURCE)
          : new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY),
    });
    schemaRegistryNameMap.set(environment.name, schemaRegistry);
  });
}
