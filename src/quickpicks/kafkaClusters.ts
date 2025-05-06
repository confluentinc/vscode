import { commands, QuickPickItemKind, ThemeIcon, window } from "vscode";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "../authn/constants";
import { IconNames } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { getConnectionLabel, isCCloud, isDirect, isLocal } from "../models/resource";
import { getTopicViewProvider } from "../viewProviders/topics";
import { QuickPickItemWithValue } from "./types";

// Exported only for testsuite purposes.
export const logger = new Logger("quickpicks.kafkaClusters");

/** Wrapper for the Kafka Cluster quickpick to accomodate data-fetching time and display a progress indicator on the Topics view. */
export async function kafkaClusterQuickPickWithViewProgress(): Promise<KafkaCluster | undefined> {
  return await window.withProgress(
    {
      location: { viewId: "confluent-topics" },
      title: "Loading Kafka clusters...",
    },
    async () => {
      return await kafkaClusterQuickPick();
    },
  );
}

/** Type for filter function applied to kafka clusters before showing in kafkaClusterQuickPick() */
export type KafkaClusterFilter = (cluster: KafkaCluster) => boolean;

export type KafkaClusterQuickPickOptions = {
  /** Overriding string for the quickpick prompt */
  placeHolder?: string;
  /** Function to filter the list of Kafka clusters before making quickpick items. */
  filter?: KafkaClusterFilter;
};

/**
 * Create and await a quickpick to let the user choose a {@link KafkaCluster}, separated by
 * connection type and environment.
 *
 * @param placeHolder The placeholder text to show in the quickpick.
 * @param filter A filter function to apply to the list of Kafka clusters. If provided, only
 *               clusters that pass the filter will be shown.
 * @returns The selected {@link KafkaCluster}, or undefined if the user cancels the quickpick.
 *
 * Example:
 * ---------------------------------- Local
 * confluent-local (local-id1)
 * ---------------------------------- Confluent Cloud: env1
 * ccloud-cluster1 (lkc-id1)
 * ccloud-cluster2 (lkc-id2)
 * ---------------------------------- Confluent Cloud: env2
 * ccloud-cluster3 (lkc-id3)
 * ---------------------------------- Other: directEnv1
 * direct-cluster1 (direct-cluster-id1)
 */
export async function kafkaClusterQuickPick(
  options: KafkaClusterQuickPickOptions = {},
): Promise<KafkaCluster | undefined> {
  const environments: Environment[] = [];

  let kafkaClusters: KafkaCluster[] = [];

  // TODO: enforce ordering between CCloud loader, Local loader, and Direct loaders?
  for (const loader of ResourceLoader.loaders()) {
    const envs: Environment[] = await loader.getEnvironments();
    environments.push(...envs);
    for (const env of envs) {
      const clusters: KafkaCluster[] = await loader.getKafkaClustersForEnvironmentId(env.id);
      if (clusters.length > 0) {
        kafkaClusters.push(...clusters);
      }
    }
  }

  if (kafkaClusters.length === 0) {
    let login: string = "";
    let local: string = "";
    if (!getContextValue(ContextValues.ccloudConnectionAvailable)) {
      login = CCLOUD_SIGN_IN_BUTTON_LABEL;
    }
    if (!getContextValue(ContextValues.localKafkaClusterAvailable)) {
      local = "Start Local Resources";
    }
    // TODO: offer button for creating a direct connection?
    window.showInformationMessage("No Kafka clusters available.", login, local).then((selected) => {
      if (selected === login) {
        commands.executeCommand("confluent.connections.ccloud.signIn");
      } else if (selected === local) {
        commands.executeCommand("confluent.docker.startLocalResources");
      }
    });
    return;
  }

  logger.debug("generating Kafka cluster quickpick", {
    local: kafkaClusters.filter((cluster) => isLocal(cluster)).length,
    ccloud: kafkaClusters.filter((cluster) => isCCloud(cluster)).length,
    direct: kafkaClusters.filter((cluster) => isDirect(cluster)).length,
  });

  // if there's a focused cluster, push it to the top of the list
  const focusedCluster: KafkaCluster | null = getTopicViewProvider().kafkaCluster;
  const focusedClusterIndex: number = kafkaClusters.findIndex(
    (cluster) => cluster.id === focusedCluster?.id,
  );
  if (focusedClusterIndex !== -1) {
    kafkaClusters.splice(focusedClusterIndex, 1);
    kafkaClusters.unshift(focusedCluster!);
  }

  // If caller provides a filter, apply it to the list of Kafka clusters.
  if (options.filter) {
    kafkaClusters = kafkaClusters.filter((cluster) => options.filter!(cluster));
  }

  // convert all available Kafka Clusters to quick pick items and keep track of the last env name
  // used for the separators
  const clusterItems: QuickPickItemWithValue<KafkaCluster>[] = [];

  let lastSeparator: string = "";
  for (const cluster of kafkaClusters) {
    const environment: Environment | undefined = environments.find(
      (env) => env.id === cluster.environmentId,
    );
    if (!environment) {
      // Should not happen if loader.getKafkaClustersForEnvironmentId()
      // results are self-consistent with loader.getEnvironments().
      logger.warn(`No environment found for Kafka cluster ${cluster.name}`);
      return;
    }
    const isFocusedCluster = focusedCluster?.id === cluster.id;
    // show a separator by environment to make it easier to differentiate between the connection types
    // and make it clear which environment the cluster(s) are associated with
    const connectionLabel = getConnectionLabel(environment.connectionType);
    // if the connection label is the same as the environment name, only show one
    const separatorLabel =
      connectionLabel === environment.name
        ? connectionLabel
        : `${connectionLabel}: ${environment.name}`;
    if (lastSeparator !== separatorLabel) {
      clusterItems.push({
        kind: QuickPickItemKind.Separator,
        label: separatorLabel,
      });
      lastSeparator = separatorLabel;
    }
    // show the currently-focused cluster, if there is one
    const icon = isFocusedCluster ? IconNames.CURRENT_RESOURCE : cluster.iconName;
    clusterItems.push({
      label: cluster.name,
      description: cluster.id,
      iconPath: new ThemeIcon(icon),
      value: cluster,
    });
  }

  // prompt the user to select a Kafka Cluster
  const chosenClusterItem: QuickPickItemWithValue<KafkaCluster> | undefined =
    await window.showQuickPick(clusterItems, {
      placeHolder: options.placeHolder || "Select a Kafka cluster",
      ignoreFocusOut: true,
    });
  return chosenClusterItem ? chosenClusterItem.value : undefined;
}

/**
 * Quickpick for selecting a Kafka cluster to use as the default database for a Flink statement.
 * @param computePool The compute pool to use as the context for the quickpick (limits to clusters in same cloud provider/region).
 * @param placeholder Optionally override the placeholder text for the quickpick.
 *                    Defaults to "Select the Kafka cluster to use as the default database for the statement".
 * @returns chosen Kafka cluster or undefined if the user cancels the quickpick.
 */
export async function flinkDatabaseQuickpick(
  computePool: CCloudFlinkComputePool,
  placeholder: string = "Select the Kafka cluster to use as the default database for the statement",
): Promise<KafkaCluster | undefined> {
  return await kafkaClusterQuickPick({
    placeHolder: placeholder,
    filter: (cluster: KafkaCluster) => {
      if (!isCCloud(cluster)) {
        // Only CCloud clusters are supported for Flink compute pools.
        return false;
      }

      // Include if the cluster is in the same provider + region as the compute pool.
      // (Flink can query cross-environment, but not cross-provider/region.)
      const ccloudCluster = cluster as CCloudKafkaCluster;
      return (
        ccloudCluster.provider === computePool.provider &&
        ccloudCluster.region === computePool.region
      );
    },
  });
}
