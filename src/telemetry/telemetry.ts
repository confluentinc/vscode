import * as vscode from "vscode";
import { UserInfo } from "../clients/sidecar/models/UserInfo";
import { logUsage, UserEvent } from "./events";

/** Given authenticated session and/or userInfo, clean the data & send an Identify event to Segment via TelemetryLogger
 * @param eventName - The event name to be sent to Segment as a follow up per docs: "follow the Identify call with a Track event that records what caused the user to be identified"
 * @param userInfo - The UserInfo object from the Authentiation event
 * @param session - The vscode.AuthenticationSession object from an existing session
 * ```
 * sendTelemetryIdentifyEvent({eventName: "Event That Triggered Identify", userInfo: { id: "123", ...} });"
 * ```
 */
export function sendTelemetryIdentifyEvent({
  eventName,
  userInfo,
  session,
}: {
  eventName: UserEvent;
  userInfo: UserInfo | undefined;
  session: vscode.AuthenticationSession | undefined;
}) {
  const id = userInfo?.id || session?.account.id;
  const username = userInfo?.username || session?.account.label;
  const social_connection = userInfo?.social_connection;
  let domain: string | undefined;
  if (username) {
    //  email is redacted by VSCode TelemetryLogger, but we extract domain for Confluent analytics use
    const emailRegex = /@[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+/;
    const match = username.match(emailRegex);
    if (match) {
      domain = username.split("@")[1];
    }
  }
  if (id) {
    logUsage(eventName, {
      identify: true,
      status: "identify",
      user: { id, domain, social_connection },
    });
  }
}
