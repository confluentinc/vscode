import { SystemApi } from "../clients/docker";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";

export * from "./configs";
export * from "./listener";

const logger = new Logger("docker");

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
