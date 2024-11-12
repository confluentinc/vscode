import { normalize } from "path";
import { Agent, RequestInit as UndiciRequestInit } from "undici";
import { commands, env, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { ResponseError, SystemApi } from "../clients/docker";
import { logResponseError } from "../errors";
import { Logger } from "../logging";
import {
  LOCAL_DOCKER_SOCKET_PATH,
  LOCAL_KAFKA_IMAGE,
  LOCAL_KAFKA_IMAGE_TAG,
  LOCAL_SCHEMA_REGISTRY_IMAGE,
  LOCAL_SCHEMA_REGISTRY_IMAGE_TAG,
} from "../preferences/constants";
import {
  DEFAULT_KAFKA_IMAGE_REPO,
  DEFAULT_KAFKA_IMAGE_TAG,
  DEFAULT_SCHEMA_REGISTRY_REPO,
  DEFAULT_SCHEMA_REGISTRY_TAG,
} from "./constants";

const logger = new Logger("docker.configs");

export const DEFAULT_WINDOWS_SOCKET_PATH = "//./pipe/docker_engine";
export const DEFAULT_UNIX_SOCKET_PATH = "/var/run/docker.sock";

/** Get the path to the Docker socket based on user settings or platform defaults. */
export function getSocketPath(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  let path: string = configs.get(LOCAL_DOCKER_SOCKET_PATH, "").trim();

  if (process.platform === "win32") {
    path = path ? normalize(path) : normalize(DEFAULT_WINDOWS_SOCKET_PATH);
  } else {
    path = path ? path : DEFAULT_UNIX_SOCKET_PATH;
  }
  logger.trace("using docker socket path:", { socketPath: path });

  return path;
}

/** Get the local Kafka image name based on user settings. */
export function getLocalKafkaImageName(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  return configs.get(LOCAL_KAFKA_IMAGE, DEFAULT_KAFKA_IMAGE_REPO);
}

/** Get the local Kafka image tag based on user settings. */
export function getLocalKafkaImageTag(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  return configs.get(LOCAL_KAFKA_IMAGE_TAG, DEFAULT_KAFKA_IMAGE_TAG);
}

/** Get the local Schema Registry image name based on user settings. */
export function getLocalSchemaRegistryImageName(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  // we are not currently exposing these settings, so we'll always use the default value
  return configs.get(LOCAL_SCHEMA_REGISTRY_IMAGE, DEFAULT_SCHEMA_REGISTRY_REPO);
}

/** Get the local Schema Registry image tag based on user settings. */
export function getLocalSchemaRegistryImageTag(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  // we are not currently exposing these settings, so we'll always use the default value
  return configs.get(LOCAL_SCHEMA_REGISTRY_IMAGE_TAG, DEFAULT_SCHEMA_REGISTRY_TAG);
}

/** Default request options for Docker API requests, to be used with service class methods from `src/clients/docker/*`. */
export function defaultRequestInit(): RequestInit {
  // NOTE: This looks weird because our openapi-generator client code (in `src/clients/**`) relies on
  // RequestInit from `@types/node/globals.d.ts` which TypeScript complains about since it thinks
  // "dispatcher" doesn't exist (which it does).
  // This is a workaround to make TypeScript happy until we can find a better way to add the
  // `socketPath` to `RequestInit`.
  // (Also see https://github.com/nodejs/undici/issues/1489#issuecomment-1543856261)
  const init: UndiciRequestInit = {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    dispatcher: new Agent({
      connect: {
        socketPath: getSocketPath(),
      },
    }),
  };
  return init as RequestInit;
}

/**
 * Check if Docker is available by attempting to ping the API.
 * @see https://docs.docker.com/reference/api/engine/version/v1.47/#tag/System/operation/SystemPing
 */
export async function isDockerAvailable(showNotification: boolean = false): Promise<boolean> {
  const client = new SystemApi();
  const init: RequestInit = defaultRequestInit();
  try {
    const resp: string = await client.systemPing(init);
    logger.debug("docker ping response:", resp);
    return true;
  } catch (error) {
    logResponseError(error, "docker ping", {});
    if (showNotification) {
      await showDockerUnavailableErrorNotification(error);
    }
  }
  return false;
}

/** Show a notification after getting an error while attempting to ping the Docker engine API. */
export async function showDockerUnavailableErrorNotification(error: unknown): Promise<void> {
  let notificationMessage: string = "";

  // buttons to show in the notification; if left as empty strings, they won't appear at all
  let primaryButton: string = "";
  let secondaryButton: string = "";

  if (error instanceof ResponseError) {
    let errorMessage: string;
    try {
      // e.g. {"message":"client version 1.47 is too new. Maximum supported API version is 1.43"}
      errorMessage = (await error.response.clone().json()).message;
    } catch {
      errorMessage = await error.response.clone().text();
    }
    primaryButton = "Show Logs";
    secondaryButton = "File Issue";
    notificationMessage = `Error ${error.response.status}: ${errorMessage}`;
  } else {
    // likely FetchError->TypeError: connect ENOENT <socket path> but not a lot else we can do here
    primaryButton = "Install Docker";
    secondaryButton = "Show Logs";
    notificationMessage = "Please install Docker and try again once it's running.";
  }

  window
    .showErrorMessage(
      "Docker is not available: " + notificationMessage,
      primaryButton,
      secondaryButton,
    )
    .then((selection) => {
      switch (selection) {
        case "Install Docker": {
          const uri = Uri.parse("https://docs.docker.com/engine/install/");
          env.openExternal(uri);
          break;
        }
        case "Show Logs":
          commands.executeCommand("confluent.showOutputChannel");
          break;
        case "File Issue":
          commands.executeCommand("confluent.support.issue");
          break;
      }
    });
}
