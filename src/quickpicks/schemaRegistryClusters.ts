import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getEnvironments } from "../graphql/environments";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { getCCloudConnection } from "../sidecar/connections";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("quickpicks.schemaRegistryClusters");

/** Progress wrapper for the Schema Registry quickpick to accomodate data-fetching time. */
export async function schemaRegistryQuickPick(): Promise<SchemaRegistryCluster | undefined> {
  return await vscode.window.withProgress(
    {
      location: { viewId: "confluent-schemas" },
      title: "Loading Schema Registry clusters...",
    },
    async () => {
      return await generateSchemaRegistryClusterQuickPick();
    },
  );
}

/**
 * Create a quickpick to let the user choose a Schema Registry cluster (listed by CCloud environment
 * separators). Mainly used in the event a command was triggered through the command palette instead
 * of through the view->item->context menu.
 */
async function generateSchemaRegistryClusterQuickPick(): Promise<
  SchemaRegistryCluster | undefined
> {
  if (!(await getCCloudConnection())) {
    return undefined;
  }
  // list all Schema Registry clusters for all CCloud environments for the given connection; to be
  // separated further by environment in the quickpick menu below
  const envGroups = await getEnvironments();
  const clusters: SchemaRegistryCluster[] = envGroups
    .map((group) => group.schemaRegistry)
    .filter((cluster) => cluster !== undefined) as SchemaRegistryCluster[];
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
  logger.info(`Found ${environments.length} environments`);

  const clusterItems: vscode.QuickPickItem[] = [
    {
      kind: vscode.QuickPickItemKind.Separator,
      label: "Confluent Cloud",
    },
  ];
  const schemaRegistryClusterMap: Map<string, SchemaRegistryCluster> = new Map();
  clusters.forEach((cluster: SchemaRegistryCluster) => {
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
