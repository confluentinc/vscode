/** Commands for scaffolding new projects using the template service **/

import type * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import type { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { KafkaCluster } from "../models/kafkaCluster";
import type { CCloudOrganization } from "../models/organization";
import { KafkaTopic } from "../models/topic";
import { showErrorNotificationWithButtons } from "../notifications";
import { removeProtocolPrefix } from "../utils/bootstrapServers";
import type { PrefilledTemplateOptions } from "./utils/scaffoldUtils";
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
): Promise<void> {
  let templateParams: PrefilledTemplateOptions;
  let telemetrySource: string;

  const loader = ResourceLoader.getInstance(item.connectionId);
  const environment = await loader.getEnvironment(item.environmentId);
  if (!environment) {
    void showErrorNotificationWithButtons("Unable to find environment for the selected item.");
    return;
  }

  if (item instanceof KafkaCluster || item instanceof KafkaTopic) {
    if (item instanceof KafkaCluster) {
      const bootstrapServers: string = removeProtocolPrefix(item.bootstrapServers);
      templateParams = {
        bootstrap_server: bootstrapServers,
        cc_bootstrap_server: bootstrapServers,
        templateType: "kafka",
      };
      telemetrySource = "cluster";
    } else {
      // KafkaTopic
      const clusters = environment.kafkaClusters;
      const cluster = clusters.find((c) => c.id === item.clusterId);
      if (!cluster) {
        void showErrorNotificationWithButtons(
          `Unable to find Kafka cluster for topic "${item.name}".`,
        );
        return;
      }
      const bootstrapServers: string = removeProtocolPrefix(cluster.bootstrapServers);
      templateParams = {
        bootstrap_server: bootstrapServers,
        cc_bootstrap_server: bootstrapServers,
        cc_topic: item.name,
        topic: item.name,
        templateType: "kafka",
      };
      telemetrySource = "topic";
    }

    // Mix in cc_schema_registry_url if the environment has a schema registry, regardless
    // of the item type.
    if (environment.schemaRegistry) {
      // URI, URL. Tomato, tomahto. This field is modeled as "uri" but it's really a URL,
      // in that it starts with "http[s]://".
      templateParams["cc_schema_registry_url"] = environment.schemaRegistry.uri;
    }
  } else {
    // flink compute pool
    const organization: CCloudOrganization | undefined =
      await CCloudResourceLoader.getInstance().getOrganization();
    templateParams = {
      cc_environment_id: item.environmentId,
      cc_organization_id: organization?.id,
      cloud_region: item.region,
      cloud_provider: item.provider,
      cc_compute_pool_id: item.id,
      templateType: "flink",
    };
    telemetrySource = "compute pool";
  }

  await scaffoldProjectRequest(templateParams, telemetrySource);
}

export function registerProjectGenerationCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.scaffold", scaffoldProjectCommand),
    registerCommandWithLogging("confluent.resources.scaffold", resourceScaffoldProjectCommand),
    registerCommandWithLogging("confluent.artifacts.scaffold", scaffoldFlinkArtifactCommand),
  ];
}
