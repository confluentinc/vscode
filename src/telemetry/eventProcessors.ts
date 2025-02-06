import * as Sentry from "@sentry/node";
import { env, workspace } from "vscode";
import { observabilityContext } from "../context/observability";
import { extractErrorInformation } from "../errors";

/** Helper function to make sure the user has Telemetry ON before sending Sentry error events */
export function checkTelemetrySettings(event: Sentry.Event) {
  const telemetryLevel = workspace.getConfiguration()?.get("telemetry.telemetryLevel");
  if (!env.isTelemetryEnabled || telemetryLevel === "off") {
    // Returning `null` will drop the event
    return null;
  }
  return event;
}

/** Include this extension instance's {@link observabilityContext} under the `extra` context. */
export function includeObservabilityContext(event: Sentry.Event): Sentry.Event {
  event.extra = { ...event.extra, ...observabilityContext.toRecord() };
  return event;
}

export async function handleError(event: Sentry.Event): Sentry.Event | null {
  if (event.exception) {
    const errorInfo = await extractErrorInformation(event.exception);
    if (errorInfo) {
      event.exception = errorInfo.e;
    }
  }
}
