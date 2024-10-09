import { normalize } from "path";
import { Agent, RequestInit as UndiciRequestInit } from "undici";
import { workspace, WorkspaceConfiguration } from "vscode";
import { SystemApi } from "../clients/docker";
import { Logger } from "../logging";
import { LOCAL_DOCKER_SOCKET_PATH } from "../preferences/constants";

const logger = new Logger("docker.client");

/** Get the path to the Docker socket based on user settings or platform defaults. */
function getSocketPath(): string {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  let path: string = configs.get(LOCAL_DOCKER_SOCKET_PATH, "").trim();
  if (!path || path !== "") {
    // no socketPath config set by user, try to guess the default based on platform
    if (process.platform === "win32") {
      path = normalize("//./pipe/docker_engine");
    } else {
      path = "/var/run/docker.sock";
    }
  } else {
    logger.debug("using docker socket path from extension settings", { socketPath: path });
  }
  return path;
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
export async function isDockerAvailable(): Promise<boolean> {
  const client = new SystemApi();
  const init: RequestInit = defaultRequestInit();
  try {
    const resp = await client.systemPing(init);
    logger.debug("docker ping response:", resp);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      logger.debug("can't ping docker:", {
        error: error.message,
      });
    }
  }
  return false;
}
