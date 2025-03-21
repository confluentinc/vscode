import { LDElectronMainClient, initializeInMain } from "launchdarkly-electron-client-sdk";
import { LD_CLIENT_ID, LD_CLIENT_OPTIONS, LD_CLIENT_USER_INIT } from "./constants";

/** Initializes the LaunchDarkly client. Wraps the SDK's initializeInMain for easier testing. */
export function clientInit(): LDElectronMainClient | undefined {
  if (!LD_CLIENT_ID) {
    return;
  }
  return initializeInMain(LD_CLIENT_ID, LD_CLIENT_USER_INIT, LD_CLIENT_OPTIONS);
}
