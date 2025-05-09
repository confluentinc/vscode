import * as vscode from "vscode";
import {
  ListScaffoldV1TemplatesRequest,
  ScaffoldV1Template,
  ScaffoldV1TemplateList,
  TemplatesScaffoldV1Api,
} from "../clients/scaffoldingService";
import { registerCommandWithLogging } from "../commands";
import { projectScaffoldUri } from "../emitters";
import { logError } from "../errors";
import { ResourceLoader } from "../loaders";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { Logger } from "../logging"; // Update the path to the correct location of the logger module
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { KafkaCluster } from "../models/kafkaCluster";
import { CCloudOrganization } from "../models/organization";
import { KafkaTopic } from "../models/topic";
import { showErrorNotificationWithButtons } from "../notifications";
import { applyTemplate, pickTemplate } from "../scaffold";
import { getSidecar as fetchSidecar } from "../sidecar";
import { UserEvent, logUsage } from "../telemetry/events";
import { removeProtocolPrefix } from "../utils/bootstrapServers";

const logger = new Logger("projectGeneration");

interface PrefilledTemplateOptions {
  templateCollection?: string;
  templateName?: string;
  templateType?: string;
  bootstrap_server?: string;
  cc_bootstrap_server?: string;
  cc_topic?: string;
  topic?: string;
  cc_environment_id?: string;
  cc_organization_id?: string;
  cloud_region?: string;
  cloud_provider?: string;
  cc_compute_pool_id?: string;
  [key: string]: string | undefined;
}

export function registerProjectGenerationCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.projectGeneration", scaffoldProjectRequest),
    registerCommandWithLogging(
      "confluent.resources.projectGeneration",
      resourceScaffoldProjectRequest,
    ),
  ];
}

export async function handleProjectScaffoldUri(
  collection: string | null,
  template: string | null,
  isFormNeeded: boolean | null,
  options: { [key: string]: string },
): Promise<void> {
  if (!collection || !template) {
    vscode.window.showErrorMessage(
      "Missing required parameters for project generation. Please check the URI.",
    );
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating Project",
      cancellable: true,
    },
    async (progress) => {
      progress.report({ message: "Applying template..." });
      if (isFormNeeded) {
        return await scaffoldProjectRequest({
          templateCollection: collection,
          templateName: template,
          ...options,
        });
      }
      return await applyTemplate(
        {
          spec: {
            name: template,
            template_collection: { id: collection },
            display_name: template,
          },
        } as ScaffoldV1Template,
        options,
        "uri",
      );
    },
  );

  if (result) {
    if (!result.success) {
      if (result.message !== "Project generation cancelled before save.") {
        showErrorNotificationWithButtons(
          "Error generating project. Check the template options and try again.",
        );
        logUsage(UserEvent.ProjectScaffoldingAction, {
          status: "URI handling failed",
          templateCollection: collection,
          templateId: template,
          itemType: "uri",
        });
      }
      // show the form so the user can adjust inputs as needed
      await scaffoldProjectRequest({
        templateCollection: collection,
        templateName: template,
        ...options,
      });
    } else {
      logUsage(UserEvent.ProjectScaffoldingAction, {
        status: "URI handling succeeded",
        templateCollection: collection,
        templateId: template,
        itemType: "uri",
      });
    }
  }
}

export function setProjectScaffoldListener(): vscode.Disposable {
  const disposable = projectScaffoldUri.event(async (uri: vscode.Uri) => {
    // manually parse the URI query since URLSearchParams will attempt to decode it again
    const params = new Map<string, string>();
    if (uri.query) {
      const parts = uri.query.split("&");
      for (const part of parts) {
        const [key, value] = part.split("=");
        if (key && typeof value !== "undefined") {
          params.set(key, value);
        }
      }
    }

    const collection = params.get("collection") ?? null;
    const template = params.get("template") ?? null;
    const isFormNeeded = params.get("isFormNeeded") === "true";

    params.delete("collection");
    params.delete("template");
    const options: { [key: string]: string } = Object.fromEntries(params.entries());
    await handleProjectScaffoldUri(collection, template, isFormNeeded, options);
  });

  return disposable;
}

export async function getTemplatesList(
  collection?: string,
  sanitizeOptions: boolean = false,
): Promise<ScaffoldV1TemplateList> {
  // TODO: fetch CCloud templates here once the sidecar supports authenticated template listing

  const client: TemplatesScaffoldV1Api = (await fetchSidecar()).getTemplatesApi();
  const requestBody: ListScaffoldV1TemplatesRequest = {
    template_collection_name: collection ?? "vscode",
  };
  const templateListResponse = await client.listScaffoldV1Templates(requestBody);
  if (sanitizeOptions) {
    const templates = Array.from(templateListResponse.data) as ScaffoldV1Template[];
    templates.forEach((template) => {
      const spec = template.spec!;
      if (spec.options) {
        const sanitizedOptions = Object.fromEntries(
          Object.entries(spec.options).filter(([key]) => {
            return !key.toLowerCase().includes("key") && !key.toLowerCase().includes("secret");
          }),
        );
        spec.options = sanitizedOptions;
      }
    });
  }
  return templateListResponse;
}

export async function resourceScaffoldProjectRequest(
  item?: KafkaCluster | KafkaTopic | CCloudFlinkComputePool,
): Promise<void> {
  if (item instanceof KafkaCluster) {
    const bootstrapServers: string = removeProtocolPrefix(item.bootstrapServers);
    return await scaffoldProjectRequest({
      bootstrap_server: bootstrapServers,
      cc_bootstrap_server: bootstrapServers,
      templateType: "kafka",
    });
  } else if (item instanceof KafkaTopic) {
    const clusters = await ResourceLoader.getInstance(
      item.connectionId,
    ).getKafkaClustersForEnvironmentId(item.environmentId);
    const cluster = clusters.find((c) => c.id === item.clusterId);
    if (!cluster) {
      showErrorNotificationWithButtons(`Unable to find Kafka cluster for topic "${item.name}".`);
      return;
    }
    const bootstrapServers: string = removeProtocolPrefix(cluster.bootstrapServers);
    return await scaffoldProjectRequest({
      bootstrap_server: bootstrapServers,
      cc_bootstrap_server: bootstrapServers,
      cc_topic: item.name,
      topic: item.name,
      templateType: "kafka",
    });
  } else if (item instanceof CCloudFlinkComputePool) {
    const organization: CCloudOrganization | undefined =
      await CCloudResourceLoader.getInstance().getOrganization();
    return await scaffoldProjectRequest({
      cc_environment_id: item.environmentId,
      cc_organization_id: organization?.id,
      cloud_region: item.region,
      cloud_provider: item.provider,
      cc_compute_pool_id: item.id,
      templateType: "flink",
    });
  }
}

export async function scaffoldProjectRequest(
  templateRequestOptions?: PrefilledTemplateOptions,
): Promise<void> {
  let pickedTemplate: ScaffoldV1Template | undefined = undefined;
  const templateType = templateRequestOptions?.templateType;

  try {
    logger.info("Fetching templates list");
    const templateListResponse: ScaffoldV1TemplateList = await getTemplatesList(
      templateRequestOptions?.templateCollection,
    );

    let templateList = Array.from(templateListResponse.data) as ScaffoldV1Template[];

    if (templateRequestOptions && !templateRequestOptions.templateName) {
      templateList = templateList.filter((template) => {
        const tags = template.spec?.tags || [];
        if (templateType === "flink") {
          return tags.includes("apache flink") || tags.includes("table api");
        } else if (templateType === "kafka") {
          return tags.includes("producer") || tags.includes("consumer");
        }
        return tags.includes("producer") || tags.includes("consumer");
      });

      pickedTemplate = await pickTemplate(templateList);
    } else if (templateRequestOptions && templateRequestOptions.templateName) {
      pickedTemplate = templateList.find(
        (template) => template.spec!.name === templateRequestOptions.templateName,
      );
      if (!pickedTemplate) {
        const errMsg =
          "Project template not found. Check the template name and collection and try again.";
        logError(new Error(errMsg), "template not found", {
          extra: {
            templateName: templateRequestOptions.templateName,
            templateCollection: templateRequestOptions.templateCollection,
          },
        });
        showErrorNotificationWithButtons(errMsg);
        return;
      }
    } else {
      pickedTemplate = await pickTemplate(templateList);
    }
  } catch (err) {
    logError(err, "template listing", { extra: { functionName: "scaffoldProjectRequest" } });
    vscode.window.showErrorMessage("Failed to retrieve template list");
    return;
  }

  if (!pickedTemplate) {
    return;
  }

  let telemetrySource: string | undefined;
  if (templateRequestOptions?.templateName) {
    telemetrySource = "template name";
  } else if (templateRequestOptions?.topic) {
    telemetrySource = "topic";
  } else if (templateRequestOptions?.bootstrap_server) {
    telemetrySource = "bootstrap server";
  }

  logUsage(UserEvent.ProjectScaffoldingAction, {
    status: "template picked",
    templateCollection: pickedTemplate.spec!.template_collection?.id,
    templateId: pickedTemplate.spec!.name,
    templateName: pickedTemplate.spec!.display_name,
    itemType: telemetrySource,
  });

  await handleProjectScaffoldUri(
    templateRequestOptions?.templateCollection || null,
    pickedTemplate.spec!.name || null,
    true,
    Object.fromEntries(
      Object.entries(templateRequestOptions || {})
        .filter(([key, value]) => value !== undefined)
        .map(([key, value]) => [key, value as string]),
    ),
  );
}
