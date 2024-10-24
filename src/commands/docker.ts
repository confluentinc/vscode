import { CancellationToken, Disposable, ProgressLocation, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { getLocalKafkaImageName, isDockerAvailable } from "../docker/configs";
import { LocalResourceWorkflow } from "../docker/workflows";
import { ConfluentLocalWorkflow } from "../docker/workflows/confluent-local";
import { Logger } from "../logging";

const logger = new Logger("commands.docker");

async function launchLocalKafkaWithProgress() {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    window.showErrorMessage("Unable to launch local Kafka because Docker is not available.");
    return;
  }

  await runWorkflowWithProgress();
}

async function runWorkflowWithProgress(start: boolean = true) {
  const imageRepo: string = getLocalKafkaImageName();
  logger.debug("using image repo", { imageRepo, confluent: ConfluentLocalWorkflow.imageRepo });

  // based on the imageRepo chosen by the user, select the appropriate workflow before starting
  let workflow: LocalResourceWorkflow;
  switch (imageRepo) {
    case ConfluentLocalWorkflow.imageRepo:
      workflow = ConfluentLocalWorkflow.getInstance();
      break;
    // TODO: add support for other images here
    default:
      window.showErrorMessage(`Unsupported image repo: ${imageRepo}`);
      return;
  }

  logger.debug("executing local Kafka workflow", { start, imageRepo });
  window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Local Kafka",
      cancellable: true,
    },
    async (progress, token: CancellationToken) => {
      if (start) {
        await workflow.start(token, progress);
      }
      // TODO: add support for running the workflow .stop() method
    },
  );
}

export function registerDockerCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.docker.launchLocalKafka", launchLocalKafkaWithProgress),
  ];
}
