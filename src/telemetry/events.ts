import { createHash } from "crypto";
import { TelemetryTrustedValue } from "vscode";
import { Logger } from "../logging";
import { getTelemetryLogger } from "./telemetryLogger";

const logger = new Logger("telemetry.events");

/** The names of user events that can be logged when telemetry is enabled.
 *
 * Segment Event name best practices: https://segment.com/docs/getting-started/04-full-install/#event-naming-best-practices
 * Use Proper Case, Noun + Past Tense Verb to represent the user's action (e.g. "Order Completed", "File Downloaded", "User Registered")
 *
 */
export enum UserEvent {
  CommandInvoked = "Command Invoked",
  DirectConnectionAction = "Direct Connection Action",
  ExtensionActivation = "Extension Activation",
  InputBoxFilled = "Input Box Filled",
  LocalDockerAction = "Local Docker Action",
  MessageProduceAction = "Message Produce Action",
  MessageViewerAction = "Message Viewer Action",
  NotificationButtonClicked = "Notification Button Clicked",
  ProjectScaffoldingAction = "Project Scaffolding Action",
  CCloudAuthentication = "CCloud Authentication",
  ViewSearchAction = "View Search Action",
  SchemaAction = "Schema Action",
  FlinkStatementAction = "Flink Statement Action",
  FlinkStatementViewStatistics = "Flink Statement View Statistics",
  CopilotInteraction = "Copilot Interaction",
  FlinkSqlClientInteraction = "Flink SQL Language Client Interaction",
  SidecarStartupFailure = "Sidecar Startup Failure",
  FlinkArtifactAction = "Flink Artifact Action",
  FlinkUDFAction = "Flink UDF Action",
  /**
   * Used for basic settings changes like enabling/disabling a feature or changing enum/numeric
   * values.
   *
   * This SHOULD NEVER be used for potentially sensitive string values like file paths, usernames, passwords, etc.
   */
  ExtensionSettingsChange = "Extension Settings Change",
}

/** Log a {@link UserEvent} with optional extra data. */
export function logUsage(event: UserEvent, data?: Record<string, any | TelemetryTrustedValue>) {
  logger.debug("User event", { event, data });

  // May or may send to Segment based on user settings. See checkTelemetrySettings().
  getTelemetryLogger().logUsage(event, data);
}

/** Compute a hex-encoded SHA-256 hash of a client-side string to accompany telemetry data. */
export function hashed(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
