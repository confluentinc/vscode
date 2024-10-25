import { CancellationToken, Disposable, ProgressLocation, Uri, env, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { getLocalKafkaImageName, isDockerAvailable } from "../docker/configs";
import { LocalResourceWorkflow } from "../docker/workflows";
import { ConfluentLocalWorkflow } from "../docker/workflows/confluent-local";
import { Logger } from "../logging";

const logger = new Logger("commands.docker");

async function startLocalResourcesWithProgress() {
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

  await runWorkflowWithProgress();
}

/** Run the local resource workflow(s) with a progress notification. */
async function runWorkflowWithProgress(start: boolean = true) {
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
        if (start) {
          await workflow.start(token, progress);
        }
        // TODO: add support for running the workflow .stop() method
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
  ];
}

/** Determine which Kafka workflow to use based on the user-selected configuration. */
function getKafkaWorkflow(): LocalResourceWorkflow | undefined {
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
