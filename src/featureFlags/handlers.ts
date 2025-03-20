import {
  LDElectronMainClient,
  LDFlagChangeset,
  LDFlagValue,
} from "launchdarkly-electron-client-sdk";
import { Logger } from "../logging";
import { FEATURE_FLAG_DEFAULTS, FeatureFlags } from "./constants";

const logger = new Logger("featureFlags.handlers");

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

/** Callback function for handling "ready" events from the LD stream, which sets up the initial
 * feature flag values from LaunchDarkly, overriding any default values set during activation. */
export async function handleClientReady(client: LDElectronMainClient) {
  logger.debug("client ready event, setting flags...");
  // set starting values
  for (const [key, defaultValue] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
    const actualValue: LDFlagValue = client.variation(key);
    // NOTE: uncomment the following for local testing new feature flag behavior:
    // logger.debug(
    //   `client ready event, setting ${key}=${JSON.stringify(actualValue)} (default=${JSON.stringify(defaultValue)})`,
    // );
    FeatureFlags[key] = actualValue ?? defaultValue;
  }
  logger.debug("client ready, flags set:", JSON.stringify(FeatureFlags));
}

/** Callback function for handling "change" events from the LD stream. */
export async function handleFlagChanges(changes: LDFlagChangeset) {
  logger.debug("change event:", changes);
  const trackedFlags = Object.keys(FeatureFlags);

  for (const flag of Object.keys(changes)) {
    if (!trackedFlags.includes(flag)) {
      logger.debug(`"${flag}" is not tracked, ignoring change`);
      continue;
    }
    const previousValue: LDFlagValue = changes[flag].previous;
    const currentValue: LDFlagValue = changes[flag].current;
    FeatureFlags[flag] = currentValue;
    logger.debug(`"${flag}" changed:`, { previousValue, currentValue });

    // TODO: fork handling based on different flags
  }
}
