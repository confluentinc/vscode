/** Commands for scaffolding new projects using the template service **/

import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { KafkaCluster } from "../models/kafkaCluster";
import { CCloudOrganization } from "../models/organization";
import { KafkaTopic } from "../models/topic";
import { showErrorNotificationWithButtons } from "../notifications";
import { removeProtocolPrefix } from "../utils/bootstrapServers";
import { scaffoldProjectRequest } from "./utils/scaffoldUtils";

/** Scaffold a project w/o any additional information. Offers all templates, no pre-filled-out information. */
export async function scaffoldProjectCommand() {
  return await scaffoldProjectRequest();
}

/** Scaffold a project around a Flink Artifact. */
export async function scaffoldFlinkArtifactCommand() {
  return await scaffoldProjectRequest(
    {
      templateType: "artifact",
    },
    "artifact",
  );
}

/** Scaffold a project from a KafkaCluster, KafkaTopic, or CCloudFlinkComputePool. */
export async function resourceScaffoldProjectCommand(
  item: KafkaCluster | KafkaTopic | CCloudFlinkComputePool,
) {
  if (item instanceof KafkaCluster) {
    const bootstrapServers: string = removeProtocolPrefix(item.bootstrapServers);
    return await scaffoldProjectRequest(
      {
        bootstrap_server: bootstrapServers,
        cc_bootstrap_server: bootstrapServers,
        templateType: "kafka",
      },
      "cluster",
    );
  } else if (item instanceof KafkaTopic) {
    const clusters = await ResourceLoader.getInstance(
      item.connectionId,
    ).getKafkaClustersForEnvironmentId(item.environmentId);
    const cluster = clusters.find((c) => c.id === item.clusterId);
    if (!cluster) {
      void showErrorNotificationWithButtons(
        `Unable to find Kafka cluster for topic "${item.name}".`,
      );
      return;
    }
    const bootstrapServers: string = removeProtocolPrefix(cluster.bootstrapServers);
    return await scaffoldProjectRequest(
      {
        bootstrap_server: bootstrapServers,
        cc_bootstrap_server: bootstrapServers,
        cc_topic: item.name,
        topic: item.name,
        templateType: "kafka",
      },
      "topic",
    );
  } else if (item instanceof CCloudFlinkComputePool) {
    const organization: CCloudOrganization | undefined =
      await CCloudResourceLoader.getInstance().getOrganization();
    return await scaffoldProjectRequest(
      {
        cc_environment_id: item.environmentId,
        cc_organization_id: organization?.id,
        cloud_region: item.region,
        cloud_provider: item.provider,
        cc_compute_pool_id: item.id,
        templateType: "flink",
      },
      "compute pool",
    );
  }
}

export function registerProjectGenerationCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.scaffold", scaffoldProjectCommand),
    registerCommandWithLogging("confluent.resources.scaffold", resourceScaffoldProjectCommand),
    registerCommandWithLogging("confluent.artifacts.scaffold", scaffoldFlinkArtifactCommand),
  ];
}
