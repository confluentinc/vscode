import { NetworkApi, ResponseError } from "../clients/docker";
import { logError } from "../errors";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";

const logger = new Logger("docker.networks");

export async function createNetwork(name: string, driver: string = "bridge"): Promise<void> {
  const networkClient = new NetworkApi();
  const init = await defaultRequestInit();

  try {
    await networkClient.networkCreate({ networkConfig: { Name: name, Driver: driver } }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await error.response.clone().text();
      if (body.includes("already exists")) {
        // this is fine, no need to re-throw the error
        logger.debug(`Network "${name}" with ${driver} driver already exists`);
        return;
      }
    }
    logError(error, "creating network");
    throw error;
  }
}
