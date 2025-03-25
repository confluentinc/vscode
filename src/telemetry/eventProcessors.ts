import { Event } from "@sentry/node";
import { env, workspace } from "vscode";
import { observabilityContext } from "../context/observability";

/** Helper function to make sure the user has Telemetry ON before sending Sentry error events */
export function checkTelemetrySettings(event: Event) {
  const telemetryLevel = workspace.getConfiguration()?.get("telemetry.telemetryLevel");
  if (!env.isTelemetryEnabled || telemetryLevel === "off") {
    // Returning `null` will drop the event
    return null;
  }
  return event;
}

/** Include this extension instance's {@link observabilityContext} under the `extra` context. */
export function includeObservabilityContext(event: Event): Event {
  event.extra = { ...event.extra, ...observabilityContext.toRecord() };
  return event;
}
