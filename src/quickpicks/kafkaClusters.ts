import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getEnvironments } from "../graphql/environments";
import { getLocalKafkaClusters } from "../graphql/local";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { getCCloudConnection } from "../sidecar/connections";

const logger = new Logger("quickpicks.kafkaClusters");

/** Progress wrapper for the Kafka Cluster quickpick to accomodate data-fetching time. */
export async function kafkaClusterQuickPick(
  includeLocal: boolean = true,
  includeCCloud: boolean = true,
): Promise<KafkaCluster | undefined> {
  return await vscode.window.withProgress(
    {
      location: { viewId: "confluent-topics" },
      title: "Loading Kafka clusters...",
    },
    async () => {
      return await generateKafkaClusterQuickPick(includeLocal, includeCCloud);
    },
  );
}

/**
 * Create a quickpick to let the user choose a Kafka cluster (listed by CCloud environment / "Local"
 * separators). Mainly used in the event a command was triggered through the command palette instead
 * of through the view->item->context menu.
 */
async function generateKafkaClusterQuickPick(
  includeLocal: boolean = true,
  includeCCloud: boolean = true,
): Promise<KafkaCluster | undefined> {
  // first we grab all available (local+CCloud) Kafka Clusters
  let localKafkaClusters: LocalKafkaCluster[] = [];
  if (includeLocal) {
    localKafkaClusters = await getLocalKafkaClusters();
  }
  let cloudKafkaClusters: CCloudKafkaCluster[] = [];
  let cloudEnvironments: CCloudEnvironment[] = [];
  if (includeCCloud) {
    // list all Kafka clusters for all CCloud environments for the given connection; to be separated
    // further by environment in the quickpick menu below
    if (await getCCloudConnection()) {
      const envGroups = await getEnvironments();
      cloudEnvironments = envGroups.map((group) => group.environment);
      cloudKafkaClusters = envGroups.map((group) => group.kafkaClusters).flat();
    }
  }
  // TODO: it would be nice to have an `await Promise.all()` here to speed up the process, but we
  // run into problems with the length of the array being returned from the `Promise.all()` call
  // depending on whether or not includeLocal/includeCCloud is true or false

  let availableKafkaClusters: KafkaCluster[] = [];
  availableKafkaClusters.push(...localKafkaClusters, ...cloudKafkaClusters);
  if (availableKafkaClusters.length === 0) {
    vscode.window.showInformationMessage("No Kafka clusters available.");
    return undefined;
  }

  // convert all available Kafka Clusters to quick pick items
  let clusterItems: vscode.QuickPickItem[] = [];
  // and map the cluster names to the KafkaClusters themselves since we need to pass the ID
  // through to follow-on commands, but users will be more familiar with the names
  // (for ease of looking up both local & CCloud clusters, we're using `name:id` as the key format
  // that will match the label:description format of the quick pick items below)
  const kafkaClusterNameMap: Map<string, KafkaCluster> = new Map();

  if (localKafkaClusters.length > 0) {
    // add a single separator
    clusterItems.push({
      kind: vscode.QuickPickItemKind.Separator,
      label: "Local",
    });
  }
  localKafkaClusters.forEach((kafkaCluster: LocalKafkaCluster) => {
    clusterItems.push({
      label: kafkaCluster.name,
      description: kafkaCluster.id,
      iconPath: new vscode.ThemeIcon(IconNames.LOCAL_KAFKA),
    });
    const quickPickKey = `${kafkaCluster.name}:${kafkaCluster.id}`;
    kafkaClusterNameMap.set(quickPickKey, kafkaCluster);
  });

  // make a map of all environment IDs to environments for easy lookup below
  const environmentMap: Map<string, CCloudEnvironment> = new Map();
  cloudEnvironments.forEach((env: CCloudEnvironment) => {
    environmentMap.set(env.id, env);
  });
  logger.info(`Found ${cloudEnvironments.length} environments`);

  let lastEnvName: string = "";
  cloudKafkaClusters.forEach((kafkaCluster: CCloudKafkaCluster) => {
    const environment: CCloudEnvironment | undefined = environmentMap.get(
      kafkaCluster.environmentId,
    );
    if (!environment) {
      logger.warn(`No environment found for Kafka cluster ${kafkaCluster.name}`);
      return;
    }
    // show a separator by environment to make it easier to differentiate between local+CCloud and
    // also to make it clear which environment the CCloud clusters are associated with
    if (lastEnvName !== environment.name) {
      clusterItems.push({
        kind: vscode.QuickPickItemKind.Separator,
        label: `Confluent Cloud: ${environment.name}`,
      });
      lastEnvName = environment.name;
    }
    clusterItems.push({
      label: kafkaCluster.name,
      description: kafkaCluster.id,
      iconPath: new vscode.ThemeIcon(IconNames.CCLOUD_KAFKA),
    });
    const quickPickKey = `${kafkaCluster.name}:${kafkaCluster.id}`;
    kafkaClusterNameMap.set(quickPickKey, kafkaCluster);
  });

  // prompt the user to select a Kafka Cluster
  const chosenClusterItem: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(
    clusterItems,
    {
      placeHolder: "Select a Kafka cluster",
      ignoreFocusOut: true,
    },
  );
  return chosenClusterItem
    ? kafkaClusterNameMap.get(`${chosenClusterItem.label}:${chosenClusterItem.description}`)
    : undefined;
}
