import { Analytics } from "@segment/analytics-node";
import * as Sentry from "@sentry/node";
import { randomUUID } from "crypto";
import { version as currentSidecarVersion } from "ide-sidecar";
import * as vscode from "vscode";
import { Logger } from "./logging";
// TEMP keep this import here to make sure the production bundle doesn't split chunks
import "opentelemetry-instrumentation-fetch-node";

const logger = new Logger("telemetry");

let analytics: Analytics | null = null;
let segmentAnonId: string;
let telemetryLogger: vscode.TelemetryLogger | null = null;
let warnedAboutSegmentKey = false;

/** Get the current instance of our custom Telemetry Logger, or create one if it doesn't exist
 * @returns The current instance of the Telemetry Logger
 * By default, data sent by TelemetryLogger includes VSCode Common properties.
 * We can choose not to send this data in future with `ignoreBuiltInCommonProperties`
 * The TelemetryLogger class automatically respects the users' telemetry settings
 * Usage:
 * ```
 * getTelemetryLogger().logUsage("Event Name", { data });
 * ```
 * Segment Event name best practices: https://segment.com/docs/getting-started/04-full-install/#event-naming-best-practices
 * Use Proper Case, Noun + Past Tense Verb to represent the user's action (e.g. "Order Completed", "File Downloaded", "User Registered")
 * Optionally, add any relevant data as the second parameter
 */
export function getTelemetryLogger(): vscode.TelemetryLogger {
  // If there is already an instance of the Segment Telemetry Logger, return it
  if (telemetryLogger) {
    return telemetryLogger;
  }

  // If there isn't an instance of the Telemetry Logger, create one
  if (!analytics) {
    const writeKey =
      process.env.NODE_ENV !== "production"
        ? process.env.SEGMENT_DEV_KEY
        : process.env.SEGMENT_WRITE_KEY;
    if (!writeKey) {
      // If we don't have a key let's assume it's a dev and they don't want to track anything
      // Instead, we could fill in with calls to Logger or Console logs?
      if (!warnedAboutSegmentKey) {
        // Only want to say this once, though.
        warnedAboutSegmentKey = true;
        logger.error("No Segment key found in environment variables");
      }
      return vscode.env.createTelemetryLogger({
        sendErrorData: () => {},
        sendEventData: () => {},
        flush: () => {},
      });
    }
    analytics = new Analytics({ writeKey, disable: false });
  }

  segmentAnonId = randomUUID();
  telemetryLogger = vscode.env.createTelemetryLogger({
    sendEventData: (eventName, data) => {
      const cleanEventName = eventName.replace(/^confluentinc\.vscode-confluent\//, ""); // Remove the prefix
      analytics?.track({
        anonymousId: segmentAnonId,
        event: cleanEventName,
        properties: { currentSidecarVersion, ...data }, // VSCode Common properties in data includes the extension version
      });
    },
    sendErrorData: (exception, data) => {
      logger.error("Error", { ...exception, ...data });
    },
    flush: () => {
      analytics?.closeAndFlush({ timeout: 5000 }); // force resolve after 5000ms
    },
  });

  return telemetryLogger;
}

export function checkTelemetrySettings(event: Sentry.Event) {
  const telemetryLevel = vscode.workspace.getConfiguration()?.get("telemetry.telemetryLevel");
  if (!vscode.env.isTelemetryEnabled || telemetryLevel === "off") {
    // Returning `null` will drop the event
    return null;
  }
  return event;
}
