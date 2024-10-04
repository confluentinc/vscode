import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getEnvironments } from "../graphql/environments";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("quickpicks.schemaRegistryClusters");

/** Progress wrapper for the Schema Registry quickpick to accomodate data-fetching time. */
export async function schemaRegistryQuickPick(): Promise<CCloudSchemaRegistry | undefined> {
  return await vscode.window.withProgress(
    {
      location: { viewId: "confluent-schemas" },
      title: "Loading Schema Registry clusters...",
    },
    async () => {
      return await generateSchemaRegistryQuickPick();
    },
  );
}

/**
 * Create a quickpick to let the user choose a Schema Registry cluster (listed by CCloud environment
 * separators). Mainly used in the event a command was triggered through the command palette instead
 * of through the view->item->context menu.
 */
async function generateSchemaRegistryQuickPick(): Promise<SchemaRegistry | undefined> {
  // TODO(shoup): update to support LocalSchemaRegistry
  if (!(await hasCCloudAuthSession())) {
    return undefined;
  }
  // list all Schema Registry clusters for all CCloud environments for the given connection; to be
  // separated further by environment in the quickpick menu below
  const envGroups = await getEnvironments();
  const clusters: CCloudSchemaRegistry[] = envGroups
    .map((group) => group.schemaRegistry)
    .filter((cluster) => cluster !== undefined) as CCloudSchemaRegistry[];
  if (clusters.length === 0) {
    vscode.window.showInformationMessage("No Schema Registry clusters available.");
    return undefined;
  }

  // make a map of all environment IDs to environments for easy lookup below
  const environmentMap: Map<string, CCloudEnvironment> = new Map();
  const environments: CCloudEnvironment[] = await getResourceManager().getCCloudEnvironments();
  environments.forEach((env: CCloudEnvironment) => {
    environmentMap.set(env.id, env);
  });
  logger.debug(`Found ${environments.length} environments`);

  const clusterItems: vscode.QuickPickItem[] = [
    {
      kind: vscode.QuickPickItemKind.Separator,
      label: "Confluent Cloud",
    },
  ];
  const schemaRegistryClusterMap: Map<string, CCloudSchemaRegistry> = new Map();
  clusters.forEach((cluster: CCloudSchemaRegistry) => {
    const environment: CCloudEnvironment | undefined = environmentMap.get(cluster.environmentId);
    if (!environment) {
      logger.warn(`No environment found for Schema Registry ${cluster.id}`);
      return;
    }
    clusterItems.push({
      label: environment.name,
      description: cluster.id,
      iconPath: new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY),
    });
    schemaRegistryClusterMap.set(cluster.id, cluster);
  });

  const selectedClusterItem: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    clusterItems,
    {
      placeHolder: "Select a Schema Registry cluster by Environment",
    },
  );

  return selectedClusterItem
    ? schemaRegistryClusterMap.get(selectedClusterItem.description!)
    : undefined;
}
