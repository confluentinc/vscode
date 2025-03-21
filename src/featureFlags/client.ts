import { LDElectronMainClient } from "launchdarkly-electron-client-sdk";
import { logError } from "../errors";
import { Logger } from "../logging";
import { FEATURE_FLAG_DEFAULTS, FeatureFlags } from "./constants";
import { handleClientReady, handleErrorEvent, handleFlagChanges } from "./handlers";
import { clientInit } from "./init";

const logger = new Logger("featureFlags.client");

/**
 * Singleton LaunchDarkly client.
 * @see https://launchdarkly.com/docs/sdk/client-side/node-js#initialize-the-client
 *
 * However, we're using the Electron client SDK instead of the Node.js SDK:
 * @see https://launchdarkly.com/docs/sdk/client-side/electron#why-use-this-instead-of-the-nodejs-sdk
 */
let client: LDElectronMainClient | undefined = undefined;

/**
 * Returns the singleton LaunchDarkly client. If the client is not initialized, it will attempt to
 * initialize it and set up the event listeners.
 * @see https://launchdarkly.github.io/electron-client-sdk/interfaces/_launchdarkly_electron_client_sdk_.ldelectronmainclient.html#on
 *
 * If the client fails to initialize, it will log an error and return `undefined`, and any feature
 * flag lookups will return the local defaults.
 */
export function getLaunchDarklyClient(): LDElectronMainClient | undefined {
  if (client) {
    return client;
  }

  try {
    client = clientInit();
    if (!client) {
      return;
    }
    logger.debug("created LD client, setting up event listeners");
    // if we didn't bail earlier, we have a client even if we haven't seen an "initialized" event yet
    client.on("ready", () => handleClientReady(client!));
    // this is the main one we care about after the client is ready:
    client.on("change", handleFlagChanges);
    client.on("error", handleErrorEvent);
    client.on("failed", handleFailedEvent);
    return client;
  } catch (error) {
    // try to send any client init issues to Sentry, but if the user is offline and the extension
    // can't reach LD (which probably means Sentry isn't available either), this will just log
    logError(error, "LD client init", {}, true);
  }
}

// NOTE: not part of handlers.ts since we don't want to deal with circular dependencies getting
// back to disposeLaunchDarklyClient
/** Callback function for handling "failed" events from the LD stream. */
function handleFailedEvent(error: unknown) {
  if (error instanceof Error) {
    // if online, send any failed events to Sentry so we can troubleshoot
    // if offline, just log the failed event
    logError(error, "LD failed event", {}, true);
  } else {
    logger.error("LD failed event:", error);
  }
  disposeLaunchDarklyClient();
}

/** Disposes of the LaunchDarkly client and its event listeners and client, if a client exists. */
export function disposeLaunchDarklyClient(): void {
  if (!client) {
    return;
  }

  logger.debug("disposing LD event listeners and client");
  try {
    client.off("ready", handleClientReady);
    client.off("change", handleFlagChanges);
    client.off("error", handleErrorEvent);
    client.off("failed", handleFailedEvent);
    client.close();
  } catch (error) {
    logger.error("Error closing LD client:", error);
  }
  client = undefined;
}

/** Sets the {@link FeatureFlags} with default values from {@link FEATURE_FLAG_DEFAULTS}. */
export function resetFlagDefaults(): void {
  // clear any untracked flags (likely from tests)
  for (const flag of Object.keys(FeatureFlags)) {
    if (!Object.keys(FEATURE_FLAG_DEFAULTS).includes(flag)) {
      delete FeatureFlags[flag];
    }
  }
  // set default values (back)
  for (const flag of Object.keys(FEATURE_FLAG_DEFAULTS)) {
    FeatureFlags[flag] = FEATURE_FLAG_DEFAULTS[flag];
  }
  logger.debug("local defaults set:", JSON.stringify(FeatureFlags));
}
