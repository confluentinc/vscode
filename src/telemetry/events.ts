import { TelemetryTrustedValue } from "vscode";
import { Logger } from "../logging";
import { getTelemetryLogger } from "./telemetryLogger";

const logger = new Logger("telemetry.events");

/** The names of user events that can be logged when telemetry is enabled. */
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
}

/** Log a {@link UserEvent} with optional extra data. */
export function logUsage(event: UserEvent, data?: Record<string, any | TelemetryTrustedValue>) {
  logger.debug("User event", { event, data });

  // May or may send to Segment based on user settings. See checkTelemetrySettings().
  getTelemetryLogger().logUsage(event, data);
}
