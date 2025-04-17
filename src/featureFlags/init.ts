import type { LDElectronMainClient } from "launchdarkly-electron-client-sdk";
import type { LDClientBase } from "launchdarkly-js-sdk-common";
import type { LDClient } from "launchdarkly-node-client-sdk";
import { env } from "vscode";
import { logError } from "../errors";
import { Logger } from "../logging";
import { LD_CLIENT_ID, LD_CLIENT_OPTIONS, LD_CLIENT_USER_INIT } from "./constants";

const logger = new Logger("featureFlags.init");

/** Initializes the LaunchDarkly client. Wraps the SDK's initializeInMain for easier testing. */
export async function clientInit(): Promise<LDClientBase | undefined> {
  if (!LD_CLIENT_ID) {
    return;
  }

  if (env.remoteName) {
    // use the Node client SDK if we're running in a remote environment since Electron isn't
    // available there, see:
    // https://code.visualstudio.com/api/advanced-topics/remote-extensions#using-native-node.js-modules
    try {
      const { initialize } = await import("launchdarkly-node-client-sdk");
      const nodeClient: LDClient = initialize(LD_CLIENT_ID, LD_CLIENT_USER_INIT, LD_CLIENT_OPTIONS);
      logger.debug("using Node client SDK");
      return nodeClient;
    } catch (error) {
      logError(error, "Failed to initialize Node LaunchDarkly client", {
        extra: { remoteName: env.remoteName },
      });
      return;
    }
  }

  // running in Electron, so use the Electron client SDK
  const { initializeInMain } = await import("launchdarkly-electron-client-sdk");
  const electronClient: LDElectronMainClient = initializeInMain(
    LD_CLIENT_ID,
    LD_CLIENT_USER_INIT,
    LD_CLIENT_OPTIONS,
  );
  logger.debug("using Electron client SDK");
  return electronClient;
}
