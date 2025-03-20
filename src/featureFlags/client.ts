import { LDElectronMainClient, initializeInMain } from "launchdarkly-electron-client-sdk";
import { Logger } from "../logging";
import {
  FEATURE_FLAG_DEFAULTS,
  FeatureFlags,
  LD_CLIENT_ID,
  LD_CLIENT_OPTIONS,
  LD_CLIENT_USER_INIT,
} from "./constants";
import { handleClientReady, handleFlagChanges } from "./handlers";

const logger = new Logger("featureFlags.client");

/**
 * Singleton LaunchDarkly client.
 * @see https://launchdarkly.com/docs/sdk/client-side/node-js#initialize-the-client
 *
 * However, we're using the Electron client SDK instead of the Node.js SDK:
 * @see https://launchdarkly.com/docs/sdk/client-side/electron#why-use-this-instead-of-the-nodejs-sdk
 */
let client: LDElectronMainClient | undefined = undefined;

/** Returns the LaunchDarkly client. If it fails to initialize, it will log an error and return
 * undefined and any feature flag lookups will return the local defaults. */
export function getLaunchDarklyClient(): LDElectronMainClient | undefined {
  if (!LD_CLIENT_ID) {
    logger.error("LaunchDarkly client side ID is not set");
    return;
  }
  if (client) {
    return client;
  }

  try {
    client = initializeInMain(LD_CLIENT_ID, LD_CLIENT_USER_INIT, LD_CLIENT_OPTIONS);
    setEventListeners(client);
  } catch (e) {
    if (e instanceof Error) {
      logger.error("LaunchDarkly client failed to initialize:", e.message);
    }
    return;
  }

  return client;
}

/**
 * Sets up the event listeners for the LaunchDarkly client.
 * @param client The LaunchDarkly client.
 */
export function setEventListeners(client: LDElectronMainClient): void {
  // client.on doesn't return a listener, so we have to rely on the extension's deactivate() to
  // handle the client cleanup
  client.on("ready", () => handleClientReady(client));

  client.on("failed", (err) => {
    logger.error("failed event:", err);
  });

  client.on("error", (err) => {
    logger.error("error event:", err);
  });

  // this is the main one we care about after the client is ready:
  client.on("change", handleFlagChanges);
}

/** Sets the {@link FeatureFlags} with default values from {@link FEATURE_FLAG_DEFAULTS}. */
export function setFlagDefaults(): void {
  for (const [flag, defaultValue] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
    FeatureFlags[flag] = defaultValue;
  }
  logger.debug("local defaults set:", JSON.stringify(FeatureFlags));
}
