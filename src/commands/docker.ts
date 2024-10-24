import * as Sentry from "@sentry/node";
import { CancellationToken, Disposable, ProgressLocation, Uri, env, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { getLocalKafkaImageName, isDockerAvailable } from "../docker/configs";
import { LocalResourceWorkflow } from "../docker/workflows";
import { ConfluentLocalWorkflow } from "../docker/workflows/confluent-local";
import { Logger } from "../logging";

const logger = new Logger("commands.docker");

async function startLocalResourcesWithProgress() {
  await runWorkflowWithProgress();
}

async function stopLocalResourcesWithProgress() {
  await runWorkflowWithProgress(false);
}

/** Run the local resource workflow(s) with a progress notification. */
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

  // TODO(shoup): add multi-select quickpick to determine which resource(s) to start/stop; for now
  // just default to Kafka
  const resources = ["Kafka"];

  // based on the imageRepo chosen by the user, select the appropriate workflow before running them
  const subworkflows: LocalResourceWorkflow[] = [];
  if (resources.includes("Kafka")) {
    const kafkaWorkflow = getKafkaWorkflow();
    if (kafkaWorkflow) subworkflows.push(kafkaWorkflow);
  }
  // add logic for looking up other resources' workflows here

  logger.debug("running local resource workflow(s)", { start, resources });
  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Local",
      cancellable: true,
    },
    async (progress, token: CancellationToken) => {
      for (const workflow of subworkflows) {
        token.onCancellationRequested(() => {
          logger.debug("cancellation requested, exiting workflow early", {
            start,
            workflow: workflow.constructor.name,
            resourceKind: workflow.resourceKind,
          });
          workflow.sendTelemetryEvent("Notification Button Clicked", {
            buttonLabel: "Cancel",
            notificationType: "progress",
            start,
          });
          // early returns handled within each workflow depending on how far it got
        });

        logger.debug(`running ${workflow.constructor.name} workflow`, { start });
        workflow.sendTelemetryEvent("Workflow Initiated", {
          start,
        });
        try {
          if (start) {
            await workflow.start(token, progress);
          } else {
            await workflow.stop(token, progress);
          }
          logger.debug(`finished ${workflow.constructor.name} workflow`, { start });
          workflow.sendTelemetryEvent("Workflow Finished", {
            start,
          });
        } catch (error) {
          logger.error(`error running ${workflow.constructor.name} workflow`, error);
          if (error instanceof Error) {
            workflow.sendTelemetryEvent("Workflow Errored", {
              start,
            });
            Sentry.captureException(error, {
              tags: {
                dockerImage: workflow.imageRepoTag,
                extensionUserFlow: "Local Resource Management",
                localResourceKind: workflow.resourceKind,
                localResourceWorkflow: workflow.constructor.name,
              },
            });
            workflow.showErrorNotification(
              `Error ${start ? "starting" : "stopping"} ${workflow.resourceKind}: ${error.message}`,
            );
          }
        }
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