import * as Sentry from "@sentry/node";
import { CancellationToken, Disposable, ProgressLocation, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { ResponseError } from "../clients/docker";
import { isDockerAvailable } from "../docker/configs";
import { LocalResourceKind } from "../docker/constants";
import { getKafkaWorkflow, getSchemaRegistryWorkflow } from "../docker/workflows";
import { LocalResourceWorkflow } from "../docker/workflows/base";
import { Logger } from "../logging";
import { localResourcesQuickPick } from "../quickpicks/localResources";

const logger = new Logger("commands.docker");

/** Run the .start() workflow(s) from an array of resource kinds. If none are provided, the user
 * will be shown a multi-select quickpick. */
async function startLocalResourcesWithProgress(resourceKinds: LocalResourceKind[] = []) {
  await runWorkflowWithProgress(true, resourceKinds);
}

/** Run the .stop() workflow(s) from an array of resource kinds. If none are provided, the user
 * will be shown a multi-select quickpick. */
async function stopLocalResourcesWithProgress(resourceKinds: LocalResourceKind[] = []) {
  await runWorkflowWithProgress(false, resourceKinds);
}

/**
 * Run the local resource workflow(s) with a progress notification. If no `resourceKinds` are
 * provided, the user will be shown a multi-select quickpick to choose which resources to start/stop.
 */
export async function runWorkflowWithProgress(
  start: boolean = true,
  resourceKinds: LocalResourceKind[] = [],
) {
  const dockerAvailable = await isDockerAvailable(true);
  if (!dockerAvailable) {
    return;
  }

  // show multi-select quickpick to allow user to choose which resources to launch and determine
  // how the workflow should be run
  const resources: LocalResourceKind[] =
    resourceKinds.length > 0 ? resourceKinds : await localResourcesQuickPick();
  if (resources.length === 0) {
    // nothing selected, or user clicked a quickpick button to adjust settings
    return;
  }

  // based on the imageRepo chosen by the user, select the appropriate workflow before running them
  const subworkflows: LocalResourceWorkflow[] = [];
  if (resources.includes(LocalResourceKind.Kafka)) {
    try {
      subworkflows.push(getKafkaWorkflow());
    } catch (error) {
      logger.error("error getting Kafka workflow:", error);
      return;
    }
  }
  if (resources.includes(LocalResourceKind.SchemaRegistry)) {
    try {
      subworkflows.push(getSchemaRegistryWorkflow());
    } catch (error) {
      logger.error("error getting Schema Registry workflow:", error);
      return;
    }
  }
  // add logic for looking up other resources' workflows here

  if (subworkflows.length === 0) {
    // bail early to avoid flashing an empty progress notification
    return;
  }

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
            resourceKind: workflow.resourceKind,
          });
          workflow.sendTelemetryEvent("Notification Button Clicked", {
            buttonLabel: "Cancel",
            notificationType: "progress",
            start,
          });
          // early returns handled within each workflow depending on how far it got
        });

        logger.debug(`running ${workflow.resourceKind} workflow`, { start });
        workflow.sendTelemetryEvent("Workflow Initiated", {
          start,
        });
        try {
          if (start) {
            await workflow.start(token, progress);
          } else {
            await workflow.stop(token, progress);
          }
          logger.debug(`finished ${workflow.resourceKind} workflow`, { start });
          workflow.sendTelemetryEvent("Workflow Finished", {
            start,
          });
        } catch (error) {
          logger.error(`error running ${workflow.resourceKind} workflow`, error);
          if (error instanceof Error) {
            workflow.sendTelemetryEvent("Workflow Errored", {
              start,
            });
            Sentry.captureException(error, {
              tags: {
                dockerImage: workflow.imageRepoTag,
                extensionUserFlow: "Local Resource Management",
                localResourceKind: workflow.resourceKind,
              },
            });
            let errorMsg: string = "";
            if (error instanceof ResponseError) {
              try {
                const body = await error.response.clone().json();
                errorMsg = body.message;
              } catch {
                errorMsg = error.response.statusText;
              }
            } else {
              errorMsg = error.message;
            }
            workflow.showErrorNotification(
              `Error ${start ? "starting" : "stopping"} ${workflow.resourceKind}: ${errorMsg}`,
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
