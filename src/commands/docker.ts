import * as Sentry from "@sentry/node";
import {
  CancellationToken,
  Disposable,
  ProgressLocation,
  Uri,
  window,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
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

  // ensure Kafka is started first / stopped last
  const orderedWorkflows: LocalResourceWorkflow[] = orderWorkflows(subworkflows, start);

  logger.debug("running local resource workflow(s)", { start, resources });
  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Local",
      cancellable: true,
    },
    async (progress, token: CancellationToken) => {
      for (const workflow of orderedWorkflows) {
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

/** Show the Open File dialog to let the user pick a docker file and store it in the extension configs. */
export async function addDockerPath() {
  const newDockerUris: Uri[] | undefined = await window.showOpenDialog({
    openLabel: "Select",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      Dockerfile: ["Dockerfile"],
    },
  });

  const configs: WorkspaceConfiguration = workspace.getConfiguration();

  const paths: string[] = configs.get<string[]>("docker.paths", []);

  if (newDockerUris && newDockerUris.length > 0) {
    const newDockerPath: string = newDockerUris[0].fsPath;
    if (newDockerPath.endsWith("Dockerfile")) {
      paths.push(newDockerPath);
      configs.update("docker.paths", paths, true);
      // no notification here since the setting will update in real-time when an item is added
    } else {
      // shouldn't be possible to get here since we restrict the file types in the dialog, but we
      // should include this because we can't do any kind of validation in the config itself for
      // array types
      window.showErrorMessage("Dockerfile path not added. Please select a Dockerfile.");
    }
  }
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
    registerCommandWithLogging("confluent.docker.socketPath", addDockerPath),
  ];
}

/** Get the path(s) of the file(s) based on the user's configuration. */
export function getDockerPaths(): string[] {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  const paths: string[] = configs.get<string[]>("docker.paths", []);
  // filter out paths that are empty strings or don't end with Dockerfile since the user can manually edit
  // the setting if they don't go through the `addDockerPath` command
  return paths.filter((path) => path && path.endsWith("Dockerfile"));
}

/**
 * Ensure multiple workflows are started/stopped in the correct order.
 *
 * This primarily means:
 * - if Kafka is included in the list of resources to *start* it should be started before other
 *  resources that may depend on it (e.g. Schema Registry)
 * - if Kafka is included in the list of resources to *stop*, it should be stopped after other
 *  resources that depend on it
 */
export function orderWorkflows(
  workflows: LocalResourceWorkflow[],
  start: boolean,
): LocalResourceWorkflow[] {
  if (workflows.length === 1) {
    // no need to sort if there's only one workflow
    return workflows;
  }

  const kafkaWorkflow: LocalResourceWorkflow | undefined = workflows.find(
    (workflow) => workflow.resourceKind === LocalResourceKind.Kafka,
  );
  if (!kafkaWorkflow) {
    // no ordering required yet
    // TODO(shoup): maybe update this once we include Flink and other resources
    return workflows;
  }

  // remove Kafka from the list of workflows to sort
  const kafkaDependentWorkflows = workflows.filter((workflow) => workflow !== kafkaWorkflow);

  // if Kafka is included, it should be started first / stopped last
  return start
    ? [kafkaWorkflow, ...kafkaDependentWorkflows]
    : [...kafkaDependentWorkflows, kafkaWorkflow];
}
