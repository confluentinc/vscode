import * as LaunchDarkly from "launchdarkly-node-client-sdk";
import { Logger } from "../logging";
import { FeatureFlag } from "./constants";

const logger = new Logger("featureFlags");

// TODO: fix the context
let context: LaunchDarkly.LDContext = {
  kind: "user",
  key: "user-key-123abc",
};

export const FeatureFlagMap: Map<FeatureFlag, any> = new Map();

export async function getLDClient() {
  const client = LaunchDarkly.initialize("client-side-id-123abc", context);
  try {
    await client.waitForInitialization(5);
  } catch (e) {
    if (e instanceof Error) {
      logger.error("LaunchDarkly client failed to initialize:", e.message);
    }
    return;
  }

  client.on("initialized", () => {
    FeatureFlagMap.set(
      FeatureFlag.GLOBAL_ENABLED,
      client.variation(FeatureFlag.GLOBAL_ENABLED, true) as boolean,
    );
    FeatureFlagMap.set(
      FeatureFlag.GLOBAL_NOTICES,
      client.variation(FeatureFlag.GLOBAL_NOTICES, []) as string[],
    );
    FeatureFlagMap.set(
      FeatureFlag.SEGMENT_ENABLE,
      client.variation(FeatureFlag.SEGMENT_ENABLE, true) as boolean,
    );
    FeatureFlagMap.set(
      FeatureFlag.CCLOUD_ENABLE,
      client.variation(FeatureFlag.CCLOUD_ENABLE, true) as boolean,
    );
  });
}
