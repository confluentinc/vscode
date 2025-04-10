import { Logger } from "../logging";
import { getLanguageClient } from "./client";
import { ServerRequest } from "./constants";

const logger = new Logger("languageClient.serverRequests");

export async function sendLanguageServerRequest<T>(method: ServerRequest, params: T) {
  const client = getLanguageClient();

  try {
    const result = await client.sendRequest(method, params);
    logger.info(`Request ${method} succeeded with result: ${JSON.stringify(result)}`);
  } catch (error) {
    logger.error(`Request ${method} failed with error: ${error}`);
  }
}
