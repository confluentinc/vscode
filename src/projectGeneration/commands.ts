import * as vscode from "vscode";
import { scaffoldProjectRequest } from ".";
import { registerCommandWithLogging } from "../commands";
import { ResourceLoader } from "../loaders";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { KafkaCluster } from "../models/kafkaCluster";
import { KafkaTopic } from "../models/topic";
import { showErrorNotificationWithButtons } from "../notifications";
import { removeProtocolPrefix } from "../utils/bootstrapServers";

export function registerProjectGenerationCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerCommandWithLogging("ccloud.scaffoldProject", async () => {
      await scaffoldProjectRequest();
    }),
  );

  context.subscriptions.push(
    registerCommandWithLogging("ccloud.scaffoldResource", async (resource: ResourceLoader) => {
      await resourceScaffoldProjectRequest(resource);
    }),
  );
}

export async function resourceScaffoldProjectRequest(resource: ResourceLoader) {
  if (resource instanceof KafkaCluster) {
    const clusterId = resource.id;
    const organizationId = (resource as any).parent?.id;
    const clusterName = resource.name;
    const bootstrap = (resource as any).bootstrap;
    const bootstrapWithoutProtocol = removeProtocolPrefix(bootstrap);

    await scaffoldProjectRequest({
      templateCollection: "vscode",
      templateName: "kafka",
      clusterId: String(clusterId),
      organizationId: String(organizationId),
      clusterName: String(clusterName),
      bootstrap: String(bootstrapWithoutProtocol),
    });
  } else if (resource instanceof KafkaTopic) {
    const topicName = resource.name;
    const clusterId = (resource as any).parent?.id;
    const organizationId = ((resource as any).parent?.parent as any)?.id;
    const bootstrap = (resource as any).parent?.bootstrap;
    const bootstrapWithoutProtocol = removeProtocolPrefix(bootstrap);

    await scaffoldProjectRequest({
      templateCollection: "vscode",
      templateName: "kafka",
      topicName: String(topicName),
      clusterId: String(clusterId),
      organizationId: String(organizationId),
      bootstrap: String(bootstrapWithoutProtocol),
    });
  } else if (resource instanceof CCloudFlinkComputePool) {
    const computePoolId = resource.id;
    const organizationId = (resource as any).parent?.id;
    const computePoolName = resource.name;

    await scaffoldProjectRequest({
      templateCollection: "vscode",
      templateName: "flink",
      computePoolId: String(computePoolId),
      organizationId: String(organizationId),
      computePoolName: String(computePoolName),
    });
  } else {
    await showErrorNotificationWithButtons("Scaffolding is not supported for this resource type", {
      OK: () => {},
    });
  }
}
