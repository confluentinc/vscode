import { LDFlagChangeset, LDFlagValue } from "launchdarkly-electron-client-sdk";
import { Logger } from "../logging";
import { FeatureFlags } from "./constants";

const logger = new Logger("featureFlags.changes");

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
    logger.debug(`"${flag}" changed from '${previousValue}' to '${currentValue}'`);

    // TODO: fork handling based on different flags
  }
}
