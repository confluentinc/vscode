import { TelemetryTrustedValue } from "vscode";
import { getTelemetryLogger } from "./telemetryLogger";

/** The names of user events that can be logged when telemetry is enabled. */
export enum UserEvent {
  ActivatedWithSession = "Activated With Session",

  CommandInvoked = "Command Invoked",

  DirectConnectionAction = "Direct Connection Action",

  DockerContainerStarted = "Docker Container Started",
  DockerContainerStopped = "Docker Container Stopped",
  DockerImagePulled = "Docker Image Pulled",

  ExtensionActivated = "Extension Activated",

  MessageViewerAction = "Message Viewer Action",

  NotificationButtonClicked = "Notification Button Clicked",

  ScaffoldTemplatePicked = "Scaffold Template Picked",
  ScaffoldFormSubmitted = "Scaffold Form Submitted",
  ScaffoldCancelled = "Scaffold Cancelled",
  ScaffoldCompleted = "Scaffold Completed",
  ScaffoldFolderOpened = "Scaffold Folder Opened",

  SignedIn = "Signed In",
}

/** Log a {@link UserEvent} with optional extra data. */
export function logUsage(event: UserEvent, data?: Record<string, any | TelemetryTrustedValue>) {
  getTelemetryLogger().logUsage(event, data);
}
