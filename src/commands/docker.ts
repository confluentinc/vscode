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
import { LocalResourceWorkflow } from "../docker/workflows/base";
import { showErrorNotificationWithButtons } from "../errors";
import { Logger } from "../logging";
import { ConnectionLabel } from "../models/resource";
import { LOCAL_DOCKER_SOCKET_PATH } from "../preferences/constants";
import { localResourcesQuickPick } from "../quickpicks/localResources";
import { UserEvent } from "../telemetry/events";
import { sentryCaptureException } from "../telemetry/sentryClient";

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
    resourceKinds.length > 0
      ? resourceKinds
      : await localResourcesQuickPick(
          start,
          start ? "Local Resources to Start" : "Local Resources to Stop",
          start ? "Select resources to start" : "Select resources to stop",
        );
  if (resources.length === 0) {
    // nothing selected, or user clicked a quickpick button to adjust settings
    return;
  }

  // based on the imageRepo chosen by the user, select the appropriate workflow before running them
  const subworkflows: LocalResourceWorkflow[] = [];
  if (resources.includes(LocalResourceKind.Kafka)) {
    try {
      subworkflows.push(LocalResourceWorkflow.getKafkaWorkflow());
    } catch (error) {
      logger.error("error getting Kafka workflow:", error);
      return;
    }
  }
  if (resources.includes(LocalResourceKind.SchemaRegistry)) {
    try {
      subworkflows.push(LocalResourceWorkflow.getSchemaRegistryWorkflow());
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
      title: ConnectionLabel.LOCAL,
      cancellable: true,
    },
    async (progress, token: CancellationToken) => {
      for (const workflow of orderedWorkflows) {
        token.onCancellationRequested(() => {
          logger.debug("cancellation requested, exiting workflow early", {
            start,
            resourceKind: workflow.resourceKind,
          });
          workflow.sendTelemetryEvent(UserEvent.NotificationButtonClicked, {
            buttonLabel: "Cancel",
            notificationType: "progress",
            start,
          });
          // early returns handled within each workflow depending on how far it got
        });
        progress.report({
          message: `${start ? "Starting" : "Stopping"} ${workflow.resourceKind}...`,
        });
        logger.debug(`running ${workflow.resourceKind} workflow`, { start });
        workflow.sendTelemetryEvent(UserEvent.LocalDockerAction, {
          status: "workflow initialized",
          start,
        });
        try {
          if (start) {
            await workflow.start(token, progress);
          } else {
            await workflow.stop(token, progress);
          }
          logger.debug(`finished ${workflow.resourceKind} workflow`, { start });
          workflow.sendTelemetryEvent(UserEvent.LocalDockerAction, {
            status: "workflow completed",
            start,
          });
        } catch (error) {
          logger.error(`error running ${workflow.resourceKind} workflow`, error);
          if (error instanceof Error) {
            workflow.sendTelemetryEvent(UserEvent.LocalDockerAction, {
              status: "workflow failed",
              start,
            });
            sentryCaptureException(error, {
              data: {
                tags: {
                  dockerImage: workflow.imageRepoTag,
                  extensionUserFlow: "Local Resource Management",
                  localResourceKind: workflow.resourceKind,
                },
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
            showErrorNotificationWithButtons(
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
      docker_socket: ["sock", "docker_engine"],
    },
  });

  if (!newDockerUris || newDockerUris.length === 0) {
    return;
  }

  const path: Uri = newDockerUris[0];

  if (path.fsPath.endsWith("sock") || path.fsPath.endsWith("docker_engine")) {
    const configs: WorkspaceConfiguration = workspace.getConfiguration();

    //getting the paths instead of searching their env for it

    configs.update(LOCAL_DOCKER_SOCKET_PATH, path.fsPath, true);
  } else {
    window.showErrorMessage(
      "Docker socket path not added. Please select a .sock or a docker_engine file.",
    );
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
    registerCommandWithLogging("confluent.docker.setSocketPath", addDockerPath),
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
