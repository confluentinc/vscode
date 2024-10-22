import * as vscode from "vscode";
import { UserInfo } from "./clients/sidecar/models/UserInfo";
import { getTelemetryLogger } from "./telemetry";

/** Given authenticated session and/or userInfo, clean the data & send an Identify event to Segment via TelemetryLogger*/
export function sendTelemetryIdentifyEvent({
  eventName,
  userInfo,
  session,
}: {
  eventName: string;
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
    getTelemetryLogger().logUsage(eventName, {
      identify: true,
      user: { id, domain, social_connection },
    });
  }
}
