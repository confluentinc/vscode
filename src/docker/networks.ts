import { NetworkApi, ResponseError } from "../clients/docker";
import { Logger } from "../logging";
import { defaultRequestInit } from "./configs";

const logger = new Logger("docker.networks");

export async function createNetwork(name: string, driver: string = "bridge"): Promise<void> {
  const networkClient = new NetworkApi();
  const init = defaultRequestInit();

  try {
    await networkClient.networkCreate({ networkConfig: { Name: name, Driver: driver } }, init);
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await error.response.clone().json();
      if (body.message && body.message.includes("already exists")) {
        logger.debug(`Network "${name}" with ${driver} driver already exists`);
      } else {
        logger.error("Error response creating network:", {
          status: error.response.status,
          statusText: error.response.statusText,
          body: body,
        });
      }
    } else {
      logger.error("Error creating network:", error);
    }
  }
}
