import type { LDClientBase, LDFlagChangeset, LDFlagValue } from "launchdarkly-js-sdk-common";
import { logError } from "../errors";
import { Logger } from "../logging";
import { FEATURE_FLAG_DEFAULTS, FeatureFlags } from "./constants";

const logger = new Logger("featureFlags.handlers");

/** Callback function for handling "ready" events from the LD stream, which sets up the initial
 * feature flag values from LaunchDarkly, overriding any default values set during activation. */
export async function handleClientReady(client: LDClientBase) {
  logger.debug("client ready event, setting flags...");
  // set starting values
  for (const [flag, defaultValue] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
    const actualValue: LDFlagValue = client.variation(flag);
    // NOTE: uncomment the following for local testing new feature flag behavior:
    // logger.debug(
    //   `client ready event, setting ${key}=${JSON.stringify(actualValue)} (default=${JSON.stringify(defaultValue)})`,
    // );
    FeatureFlags[flag] = actualValue ?? defaultValue;
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
  }
}

/** Callback function for handling "error" events from the LD stream. */
export function handleErrorEvent(error: unknown) {
  if (error instanceof Error) {
    // send any error events to Sentry (if online) so we can troubleshoot
    logError(error, "LD error event", {}, true);
  } else {
    logger.error("LD error event:", error);
  }
}
