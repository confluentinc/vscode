import { LDElectronMainClient, initializeInMain } from "launchdarkly-electron-client-sdk";
import { logError } from "../errors";
import { Logger } from "../logging";
import {
  FEATURE_FLAG_DEFAULTS,
  FeatureFlags,
  LD_CLIENT_ID,
  LD_CLIENT_OPTIONS,
  LD_CLIENT_USER_INIT,
} from "./constants";
import { setEventListeners } from "./handlers";

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
  } catch (error) {
    // try to send any client init issues to Sentry, but if the user is offline and the extension
    // can't reach LD (which probably means Sentry isn't available either), this will just log
    logError(error, "LD client init", {}, true);
    return;
  }

  return client;
}

/** Closes the LaunchDarkly client, if one exists. */
export function disposeLaunchDarklyClient(): void {
  if (!client) {
    return;
  }

  try {
    client.close();
  } catch (error) {
    logger.error("Error closing LD client:", error);
  }
  client = undefined;
}

/** Sets the {@link FeatureFlags} with default values from {@link FEATURE_FLAG_DEFAULTS}. */
export function setFlagDefaults(): void {
  for (const [flag, defaultValue] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
    FeatureFlags[flag] = defaultValue;
  }
  logger.debug("local defaults set:", JSON.stringify(FeatureFlags));
}

/** Look up a feature flag value. If the client is not initialized, it will return the local default. */
export function getFlagValue<T>(flag: string): T | undefined {
  // try to re-initialize if we don't have a client
  const ldClient: LDElectronMainClient | undefined = getLaunchDarklyClient();
  const defaultValue: T | undefined = FEATURE_FLAG_DEFAULTS[flag];
  let value: T | undefined = ldClient ? ldClient.variation(flag, defaultValue) : defaultValue;
  logger.debug(`returning value for "${flag}":`, { value, defaultValue });
  return value;
}
