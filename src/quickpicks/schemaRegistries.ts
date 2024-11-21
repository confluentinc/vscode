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
export async function schemaRegistryQuickPick(): Promise<SchemaRegistry | undefined> {
  const registriesByConnectionID: Map<string, SchemaRegistry[]> =
    await getRegistriesByConnectionID();

  const localSchemaRegistries: LocalSchemaRegistry[] = registriesByConnectionID.get(
    LOCAL_CONNECTION_ID,
  )! as LocalSchemaRegistry[];
  const ccloudSchemaRegistries: CCloudSchemaRegistry[] = registriesByConnectionID.get(
    CCLOUD_CONNECTION_ID,
  )! as CCloudSchemaRegistry[];

  let availableSchemaRegistries: SchemaRegistry[] = [];
  availableSchemaRegistries.push(...localSchemaRegistries, ...ccloudSchemaRegistries);
  if (availableSchemaRegistries.length === 0) {
    let login: string = "";

    if (!hasCCloudAuthSession()) {
      login = "Log in to Confluent Cloud";
      vscode.window
        .showInformationMessage(
          "Connect to Confluent Cloud to access remote schema registries.",
          login,
        )
        .then((selected) => {
          if (selected === login) {
            vscode.commands.executeCommand("confluent.connections.create");
          }
        });
      return undefined;
    }

    if (localSchemaRegistries.length === 0) {
      login = "Create a local connection.";
      vscode.window
        .showInformationMessage("No local Kafka Schema Registries available.", login)
        .then((selected) => {
          if (selected === login) {
            vscode.commands.executeCommand("confluent.docker.startLocalResources");
          }
        });
      return undefined;
    }
  } else {
    logger.debug(
      `Generating schema registry quickpick with ${localSchemaRegistries.length} local and ${ccloudSchemaRegistries.length} ccloud schema registries.`,
    );
  }

  // Is there a selected Schema Registry already focused in the Schemas view? It should
  // be the one that's selected / presented first in the quickpick.
  // TODO determine how to use this best now in the face of local + ccloud schema registries.
  const selectedSchemaRegistry: SchemaRegistry | null = getSchemasViewProvider().schemaRegistry;

  // convert all available Schema Registries to quick pick items
  const quickPickItems: vscode.QuickPickItem[] = [];

  /** Map of the quickpick labels to the original schema registry so that we can return a SchemaRegistry. */
  const labelToSchemaRegistry: Map<string, SchemaRegistry> = new Map();

  // Populate quickPickItems, schemaRegistryNameMap with the local Schema Registry + the possible selected registry.
  if (localSchemaRegistries.length > 0) {
    populateLocalSchemaRegistries(
      localSchemaRegistries,
      selectedSchemaRegistry,
      quickPickItems,
      labelToSchemaRegistry,
    );
  }

  // Likewise with the CCloud Schema Registries.
  if (ccloudSchemaRegistries.length > 0) {
    await populateCCloudSchemaRegistries(
      ccloudSchemaRegistries,
      selectedSchemaRegistry,
      quickPickItems,
      labelToSchemaRegistry,
    );
  }

  // TODO: consider how to handle getting the selected schema registry to be first. Maybe.

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
  selectedSchemaRegistry: SchemaRegistry | null,
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
  selectedSchemaRegistry: SchemaRegistry | null,
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

  // sort the Schema Registries by the env name
  ccloudSchemaRegistries.sort((a, b) => {
    const aEnvName = environmentMap.get(a.environmentId)!.name;
    const bEnvName = environmentMap.get(b.environmentId)!.name;
    return aEnvName!.localeCompare(bEnvName!);
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
