import { Uri, env } from "vscode";
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  showErrorNotificationWithButtons,
} from "../notifications";

const privateNetworkingUrlSubs: string[] = [".private.", ".accesspoint.", ".glb.", ".intranet."];

const privateNetworkingIdPrefixes: RegExp[] = [/\.dom[a-z0-9]+\./];

/** Checks if a given string contains a private networking related substring/pattern. */
export function containsPrivateNetworkPattern(url: string): boolean {
  if (!url) {
    return false;
  }
  // check for basic private networking patterns
  for (const sub of privateNetworkingUrlSubs) {
    if (url.includes(sub)) {
      return true;
    }
  }
  // handle regex matching for id prefixes
  for (const prefix of privateNetworkingIdPrefixes) {
    if (prefix.test(url)) {
      return true;
    }
  }
  return false;
}

interface PrivateNetworkingHelpNotificationOptions {
  /** Optional type of resource (e.g., "Kafka cluster", "Schema Registry") */
  resourceType?: string;
  /** Optional name of the specific resource that has private networking */
  resourceName?: string;
  /** Optional URL that was detected as a private networking endpoint */
  resourceUrl?: string;
}

/**
 * Displays an error notification about private networking configuration issues with
 * buttons to view documentation along with the default "Open Logs" and "File Issue".
 */
export function showPrivateNetworkingHelpNotification(
  options: PrivateNetworkingHelpNotificationOptions = {},
) {
  const resourceInfo = options.resourceName ? ` "${options.resourceName}"` : "";
  const typeInfo = options.resourceType || "resource";
  const urlSuffix = options.resourceUrl ? `: ${options.resourceUrl}` : "";

  const message = `Unable to connect to ${typeInfo}${resourceInfo}${urlSuffix}. This appears to be a private networking configuration issue. Verify your network settings and VPN configuration to access private Confluent resources.`;
  const buttons = {
    ["View Docs"]: () =>
      env.openExternal(
        Uri.parse("https://docs.confluent.io/cloud/current/networking/overview.html"),
      ),
    ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  };
  void showErrorNotificationWithButtons(message, buttons);
}
