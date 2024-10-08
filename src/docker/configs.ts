import { normalize } from "path";
import { Agent, RequestInit as UndiciRequestInit } from "undici";
import { workspace, WorkspaceConfiguration } from "vscode";
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

/**
 * Default request options for Docker API requests.
 *
 * NOTE: This looks weird because our openapi-generator client code (in `src/clients/**`) relies on
 * RequestInit from `@types/node/globals.d.ts` which TypeScript complains about since it thinks
 * "dispatcher" doesn't exist (which it does).
 * @see https://github.com/nodejs/undici/issues/1489#issuecomment-1543856261
 *
 * This is a workaround to make TypeScript happy until we can find a better way to add the
 * `socketPath` to `RequestInit`.
 */
export function defaultRequestInit(): RequestInit {
  const init: UndiciRequestInit = {
    dispatcher: new Agent({
      connect: {
        socketPath: getSocketPath(),
      },
    }),
  };
  return init as RequestInit;
}
