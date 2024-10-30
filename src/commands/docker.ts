import {
  CancellationToken,
  Disposable,
  env,
  ProgressLocation,
  QuickPickItem,
  Uri,
  window,
} from "vscode";
import { registerCommandWithLogging } from ".";
import {
  getLocalKafkaImageName,
  getLocalSchemaRegistryImageName,
  isDockerAvailable,
} from "../docker/configs";
import { LocalResourceWorkflow } from "../docker/workflows";
import { ConfluentLocalWorkflow } from "../docker/workflows/confluent-local";
import { ConfluentPlatformSchemaRegistryWorkflow } from "../docker/workflows/cp-schema-registry";
import { Logger } from "../logging";
import {
  KAFKA_RESOURCE_LABEL,
  localResourcesQuickPick,
  SCHEMA_REGISTRY_RESOURCE_LABEL,
} from "../quickpicks/localResources";

const logger = new Logger("commands.docker");

async function startLocalResourcesWithProgress() {
  await runWorkflowWithProgress();
}

async function stopLocalResourcesWithProgress() {
  await runWorkflowWithProgress(false);
}

/** Prompt the user with a multi-select quickpick, allowing them to choose which resource types to
 * start. Then run the local resource workflow(s) with a progress notification. */
async function runWorkflowWithProgress(start: boolean = true) {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    window
      .showErrorMessage(
        "Unable to launch local resources because Docker is not available. Please install Docker and try again once it's running.",
        "Install Docker",
      )
      .then((selection) => {
        if (selection) {
          const uri = Uri.parse("https://docs.docker.com/engine/install/");
          env.openExternal(uri);
        }
      });
    return;
  }

  // show multi-select quickpick to allow user to choose which resources to launch and determine
  // how the workflow should be run
  const resources: QuickPickItem[] = await localResourcesQuickPick();
  const resourceLabels: string[] = resources.map((resource) => resource.label);

  // based on the imageRepo chosen by the user, select the appropriate workflow before running them
  const subworkflows: LocalResourceWorkflow[] = [];
  if (resourceLabels.includes(KAFKA_RESOURCE_LABEL)) {
    const kafkaWorkflow = getKafkaWorkflow();
    if (kafkaWorkflow) subworkflows.push(kafkaWorkflow);
  }
  if (resourceLabels.includes(SCHEMA_REGISTRY_RESOURCE_LABEL)) {
    const schemaRegistryWorkflow = getSchemaRegistryWorkflow();
    if (schemaRegistryWorkflow) subworkflows.push(schemaRegistryWorkflow);
  }
  // add logic for looking up other resources' workflows here

  logger.debug("running local resource workflow(s)", { start, resourceLabels });
  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Local",
      cancellable: true,
    },
    async (progress, token: CancellationToken) => {
      for (const workflow of subworkflows) {
        logger.debug(`running ${workflow.constructor.name} workflow`, { start });
        if (start) {
          await workflow.start(token, progress);
        } else {
          await workflow.stop(token, progress);
        }
        logger.debug(`finished ${workflow.constructor.name} workflow`, { start });
      }
    },
  );
}

export function registerDockerCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.docker.startLocalResources",
      startLocalResourcesWithProgress,
    ),
    registerCommandWithLogging(
      "confluent.docker.stopLocalResources",
      stopLocalResourcesWithProgress,
    ),
  ];
}

/** Determine which Kafka workflow to use based on the user-selected configuration. */
export function getKafkaWorkflow(): LocalResourceWorkflow | undefined {
  const imageRepo: string = getLocalKafkaImageName();
  let workflow: LocalResourceWorkflow;
  switch (imageRepo) {
    case ConfluentLocalWorkflow.imageRepo:
      workflow = ConfluentLocalWorkflow.getInstance();
      break;
    // TODO: add support for other images here (apache/kafka, etc.)
    default:
      window.showErrorMessage(`Unsupported image repo: ${imageRepo}`);
      return;
  }
  return workflow;
}

/** Determine which Schema Registry workflow to use based on the user-selected configuration. */
function getSchemaRegistryWorkflow(): LocalResourceWorkflow | undefined {
  const imageRepo: string = getLocalSchemaRegistryImageName();
  let workflow: LocalResourceWorkflow;
  switch (imageRepo) {
    case ConfluentPlatformSchemaRegistryWorkflow.imageRepo:
      workflow = ConfluentPlatformSchemaRegistryWorkflow.getInstance();
      break;
    default:
      window.showErrorMessage(`Unsupported image repo: ${imageRepo}`);
      return;
  }
  return workflow;
}
