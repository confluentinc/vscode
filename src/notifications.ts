import { commands, window } from "vscode";
import { logError } from "./errors";
import { logUsage, UserEvent } from "./telemetry/events";

/** Default error notification buttons. */
export const DEFAULT_ERROR_NOTIFICATION_BUTTONS: Record<
  string,
  (() => void) | (() => Promise<void>)
> = {
  "Open Logs": () => commands.executeCommand("confluent.showOutputChannel"),
  "File Issue": () => commands.executeCommand("confluent.support.issue"),
};

/**
 * Shows an **info** notification with `message` and custom action buttons.
 * @param message Message to display in the notification
 * @param buttons Optional map of button labels to callback functions; defaults to not showing any
 *   buttons.
 */
export async function showInfoNotificationWithButtons(
  message: string,
  buttons?: Record<string, (() => void) | (() => Promise<void>)>,
) {
  return showNotificationWithButtons("info", message, buttons);
}

/**
 * Shows a **warning** notification with `message` and custom action buttons.
 * @param message Message to display in the notification
 * @param buttons Optional map of button labels to callback functions; defaults to showing
 *   "Open Logs" and "File Issue" buttons if not provided.
 */
export async function showWarningNotificationWithButtons(
  message: string,
  buttons?: Record<string, (() => void) | (() => Promise<void>)>,
) {
  return showNotificationWithButtons("warning", message, buttons);
}

/** Shows an **error** notification with `message` and custom action buttons.
 * @param message Message to display in the notification
 * @param buttons Optional map of button labels to callback functions; defaults to showing
 *   "Open Logs" and "File Issue" buttons if not provided.
 */
export async function showErrorNotificationWithButtons(
  message: string,
  buttons?: Record<string, (() => void) | (() => Promise<void>)>,
) {
  return showNotificationWithButtons("error", message, buttons);
}

/**
 * Shows a notification with `message` and custom action buttons.
 * @param message Message to display in the notification
 * @param buttons Optional map of button labels to callback functions; defaults to showing
 *   "Open Logs" and "File Issue" buttons if not provided AND the level is not "info".
 */
async function showNotificationWithButtons(
  level: "info" | "warning" | "error",
  message: string,
  buttons?: Record<string, (() => void) | (() => Promise<void>)>,
) {
  const buttonMap = buttons || (level !== "info" ? DEFAULT_ERROR_NOTIFICATION_BUTTONS : {});

  // we're awaiting the user's selection to more easily test the callback behavior, rather than
  // chaining with .then()
  let selection: string | undefined;
  switch (level) {
    case "info":
      selection = await window.showInformationMessage(message, ...Object.keys(buttonMap));
      break;
    case "warning":
      selection = await window.showWarningMessage(message, ...Object.keys(buttonMap));
      break;
    case "error":
      selection = await window.showErrorMessage(message, ...Object.keys(buttonMap));
      break;
    default:
      throw new Error(`Invalid notification level: ${level}`);
  }

  if (selection) {
    try {
      await buttonMap[selection]();
    } catch (e) {
      // log the error and send telemetry if the callback function throws an error
      logError(e, `"${selection}" button callback`, {
        extra: { functionName: "showNotificationWithButtons" },
      });
    }
    // send telemetry for which button was clicked
    logUsage(UserEvent.NotificationButtonClicked, {
      buttonLabel: selection,
      notificationType: level,
    });
  }
}
