import {
  LDElectronMainClient,
  LDFlagValue,
  LDUser,
  initializeInMain,
} from "launchdarkly-electron-client-sdk";
import { env } from "vscode";
import { Logger } from "../logging";
import { handleFlagChanges } from "./changes";
import { FEATURE_FLAG_DEFAULTS, FeatureFlags } from "./constants";

const logger = new Logger("featureFlags.client");

// use the client ID fetched from vault at build time for production releases, otherwise use any
// local test ID set in .env
const clientSideId: string | undefined =
  process.env.NODE_ENV !== "production"
    ? process.env.TEST_LAUNCHDARKLY_CLIENT_ID
    : process.env.LAUNCHDARKLY_CLIENT_ID;

/**
 * Singleton LaunchDarkly client.
 * @see https://launchdarkly.com/docs/sdk/client-side/node-js#initialize-the-client
 *
 * However, we're using the Electron client SDK instead of the Node.js SDK:
 * @see https://launchdarkly.com/docs/sdk/client-side/electron#why-use-this-instead-of-the-nodejs-sdk
 */
let client: LDElectronMainClient | undefined = undefined;

/** Initial user context, only updated during CCloud auth via {@link LDElectronMainClient.identify}. */
let user: LDUser = {
  key: `${env.uriScheme}-user`,
  anonymous: true,
};

/** Returns the LaunchDarkly client. If it fails to initialize, it will log an error and return
 * undefined and any feature flag lookups will return the local defaults. */
export function getLaunchDarklyClient(): LDElectronMainClient | undefined {
  if (!clientSideId) {
    logger.error("LaunchDarkly client side ID is not set");
    return;
  }
  if (client) {
    return client;
  }

  const options = {
    streaming: true, // Necessary in order for live flag updating to work
  };

  try {
    client = initializeInMain(clientSideId, user, options);
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
function setEventListeners(client: LDElectronMainClient): void {
  // client.on doesn't return a listener, so we have to rely on the extension's deactivate() to
  // handle the client cleanup
  client.on("ready", () => {
    logger.debug("client ready event, setting flags...");
    // set starting values
    for (const [key, defaultValue] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
      const actualValue: LDFlagValue = client.variation(key, defaultValue);
      FeatureFlags[key] = actualValue;
    }
    logger.debug("client ready, flags set:", FeatureFlags);
  });

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
  logger.debug("defaults set:", FeatureFlags);
}
