import * as vscode from "vscode";
import { scaffoldProjectRequest } from ".";
import { registerCommandWithLogging } from "../commands";
import { ResourceLoader } from "../loaders";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { KafkaCluster } from "../models/kafkaCluster";
import { CCloudOrganization } from "../models/organization";
import { KafkaTopic } from "../models/topic";
import { showErrorNotificationWithButtons } from "../notifications";
import { removeProtocolPrefix } from "../utils/bootstrapServers";

export function registerProjectGenerationCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.resources.scaffold", scaffoldProjectRequest),
    registerCommandWithLogging("confluent.scaffold", scaffoldProjectRequest),
  ];
}

export async function resourceScaffoldProjectRequest(resource: ResourceLoader) {
  if (resource instanceof KafkaCluster) {
    const bootstrapServers: string = removeProtocolPrefix(resource.bootstrapServers);
    return await scaffoldProjectRequest(
      {
        bootstrapServer: bootstrapServers,
        ccBootstrapServer: bootstrapServers,
        templateType: "kafka",
      },
      "cluster",
    );
  } else if (resource instanceof KafkaTopic) {
    const clusters = await ResourceLoader.getInstance(
      resource.connectionId,
    ).getKafkaClustersForEnvironmentId(resource.environmentId);
    const cluster = clusters.find((c) => c.id === resource.clusterId);
    if (!cluster) {
      showErrorNotificationWithButtons(
        `Unable to find Kafka cluster for topic "${resource.name}".`,
      );
      return;
    }
    const bootstrapServers: string = removeProtocolPrefix(cluster.bootstrapServers);
    return await scaffoldProjectRequest(
      {
        bootstrapServer: bootstrapServers,
        ccBootstrapServer: bootstrapServers,
        ccTopic: resource.name,
        topic: resource.name,
        templateType: "kafka",
      },
      "topic",
    );
  } else if (resource instanceof CCloudFlinkComputePool) {
    const organization: CCloudOrganization | undefined =
      await CCloudResourceLoader.getInstance().getOrganization();
    return await scaffoldProjectRequest(
      {
        ccEnvironmentId: resource.environmentId,
        ccOrganizationId: organization?.id,
        cloudRegion: resource.region,
        cloudProvider: resource.provider,
        ccComputePoolId: resource.id,
        templateType: "flink",
      },
      "compute pool",
    );
  } else {
    await showErrorNotificationWithButtons("Scaffolding is not supported for this resource type", {
      OK: () => {},
    });
  }
}
