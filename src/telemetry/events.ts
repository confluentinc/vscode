import { TelemetryTrustedValue } from "vscode";
import { getTelemetryLogger } from "./telemetryLogger";

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
}

/** Log a {@link UserEvent} with optional extra data. */
export function logUsage(event: UserEvent, data?: Record<string, any | TelemetryTrustedValue>) {
  getTelemetryLogger().logUsage(event, data);
}
