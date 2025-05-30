import { normalize } from "path";
import { Agent, RequestInit as UndiciRequestInit } from "undici";
import { commands, env, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { ResponseError, SystemApi } from "../clients/docker";
import { logError } from "../errors";
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
import { getDockerCredentials } from "./credentials";

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
  return configs.get(LOCAL_SCHEMA_REGISTRY_IMAGE_TAG, DEFAULT_SCHEMA_REGISTRY_TAG);
}

/** Default request options for Docker API requests, to be used with service class methods from `src/clients/docker/*`. */
export async function defaultRequestInit(): Promise<RequestInit> {
  const creds: string | undefined = await getDockerCredentials();
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
      ...(creds && { "X-Registry-Auth": creds }),
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
 *
 * If `showNotification` is true, a notification will be shown to the user with hints on how to
 * resolve the issue. Callers should **not** set this to `true` if the function is called from a
 * background process or a non-interactive command.
 */
export async function isDockerAvailable(showNotification: boolean = false): Promise<boolean> {
  const client = new SystemApi();
  const init: RequestInit = await defaultRequestInit();
  try {
    const resp: string = await client.systemPing(init);
    logger.debug("docker ping response:", resp);
    return true;
  } catch (error) {
    // either float this as an `error` log if it's a ResponseError or was an explicit action that
    // warrants notifying the user that something is wrong
    if (error instanceof ResponseError || showNotification) {
      logError(error, "docker ping");
    } else {
      // likely FetchError->TypeError: connect ENOENT <socket path> but not a lot else we can do here
      logger.debug("docker ping error:", error);
    }
    //...and then actually show the notification if it's requested
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
  let tertiaryButton: string = "";

  if (error instanceof ResponseError) {
    let errorMessage: string;
    try {
      // e.g. {"message":"client version 1.47 is too new. Maximum supported API version is 1.43"}
      errorMessage = (await error.response.clone().json()).message;
    } catch {
      errorMessage = await error.response.clone().text();
    }
    primaryButton = "Open Logs";
    secondaryButton = "File Issue";
    notificationMessage = `Error ${error.response.status}: ${errorMessage}`;
  } else {
    // likely FetchError->TypeError: connect ENOENT <socket path> but not a lot else we can do here
    primaryButton = "Install Docker";
    secondaryButton = "Open Logs";
    notificationMessage = "Please install Docker and try again once it's running.";
    // TEMPORARY: if the `http.fetchAdditionalSupport` setting is enabled, suggest disabling it
    // TODO(shoup): remove this once we have a better way to handle the behavior described in
    //   https://github.com/confluentinc/vscode/issues/751
    const configs: WorkspaceConfiguration = workspace.getConfiguration();
    if (configs.get("http.fetchAdditionalSupport", false)) {
      notificationMessage = `If Docker is currently running, please disable the "http.fetchAdditionalSupport" setting and try again.`;
      tertiaryButton = "Update Settings";
    }
  }

  window
    .showErrorMessage(
      "Docker is not available: " + notificationMessage,
      primaryButton,
      secondaryButton,
      tertiaryButton,
    )
    .then((selection) => {
      switch (selection) {
        case "Install Docker": {
          const uri = Uri.parse("https://docs.docker.com/engine/install/");
          env.openExternal(uri);
          break;
        }
        case "Open Logs":
          commands.executeCommand("confluent.showOutputChannel");
          break;
        case "File Issue":
          commands.executeCommand("confluent.support.issue");
          break;
        case "Update Settings":
          commands.executeCommand(
            "workbench.action.openSettings",
            "@id:http.fetchAdditionalSupport",
          );
          break;
      }
    });
}
