import * as vscode from "vscode";
import { IconNames } from "../constants";
import { CCloudEnvironmentGroup, getEnvironments } from "../graphql/environments";
import { getLocalResources, LocalResourceGroup } from "../graphql/local";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import {
  CCloudSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
} from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections";

const logger = new Logger("quickpicks.schemaRegistry");

/** Wrapper for the Schema Registry quickpick to accomodate data-fetching time and display a progress
 * indicator on the Schemas view. */
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
  const localSchemaRegistries: LocalSchemaRegistry[] = [];
  let cloudSchemaRegistries: CCloudSchemaRegistry[] = [];

  // first we grab all available (local+CCloud) Schema Registries
  let localGroups: LocalResourceGroup[] = [];
  let cloudGroups: CCloudEnvironmentGroup[] = [];
  [localGroups, cloudGroups] = await Promise.all([getLocalResources(), getEnvironments()]);
  localGroups.forEach((group) => {
    if (group.schemaRegistry) {
      localSchemaRegistries.push(group.schemaRegistry);
    }
  });

  // list all Schema Registries for all CCloud environments for the given connection; to be separated
  // further by environment in the quickpick menu below
  let cloudEnvironments: CCloudEnvironment[] = [];
  if (hasCCloudAuthSession()) {
    cloudEnvironments = cloudGroups.map((group) => group.environment);
    cloudGroups.forEach((group) => {
      if (group.schemaRegistry) {
        cloudSchemaRegistries.push(group.schemaRegistry);
      }
    });
  }

  let availableSchemaRegistries: SchemaRegistry[] = [];
  availableSchemaRegistries.push(...localSchemaRegistries, ...cloudSchemaRegistries);
  if (availableSchemaRegistries.length === 0) {
    vscode.window.showInformationMessage("No local Schema Registries available.");
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
      iconPath: new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY),
    });
    schemaRegistryNameMap.set(schemaRegistry.uri, schemaRegistry);
  });

  // make a map of all environment IDs to environments for easy lookup below
  const environmentMap: Map<string, CCloudEnvironment> = new Map();
  cloudEnvironments.forEach((env: CCloudEnvironment) => {
    environmentMap.set(env.id, env);
  });
  logger.debug(`Found ${cloudEnvironments.length} environments`);

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
