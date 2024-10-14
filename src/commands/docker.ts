import { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { startContainer } from "../docker/containers";
import { getLocalKafkaImageName, getLocalKafkaImageTag } from "../docker/images";

async function launchLocalKafka() {
  const imageRepo: string = getLocalKafkaImageName();
  const imageTag: string = getLocalKafkaImageTag();

  await startContainer(imageRepo, imageTag);
}

export function registerDockerCommands(): Disposable[] {
  return [registerCommandWithLogging("confluent.docker.launchLocalKafka", launchLocalKafka)];
}
