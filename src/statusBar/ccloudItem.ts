import { StatusBarAlignment, StatusBarItem, ThemeColor, window } from "vscode";
import { CCloudStatusSummary, Incident, ScheduledMaintenance } from "../ccloudStatus/types";
import { IconNames } from "../constants";
import { ERROR_BACKGROUND_COLOR_ID, WARNING_BACKGROUND_COLOR_ID } from "./constants";
import {
  ACTIVE_INCIDENT_STATUS_ORDER,
  ACTIVE_MAINTENANCE_STATUS_ORDER,
  createStatusSummaryMarkdown,
} from "./formatting";

let statusBarItem: StatusBarItem | undefined;

/** Creates, shows, and returns a Confluent Cloud {@link StatusBarItem} singleton. */
export function getCCloudStatusBarItem(): StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);

    statusBarItem.name = "Confluent Cloud Notices";
    statusBarItem.command = {
      command: "vscode.open",
      title: "Open Confluent Cloud Status",
      arguments: ["https://status.confluent.cloud/"],
    };
    statusBarItem.text = `$(${IconNames.CONFLUENT_LOGO})`;
    statusBarItem.show();
  }
  return statusBarItem;
}

/** Disposes of the Confluent Cloud {@link StatusBarItem} singleton. */
export function disposeCCloudStatusBarItem() {
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
}

/** Updates the `text`, `tooltip`, and (optionally) `backgroundColor` of the Confluent Cloud status
 * bar item based on the provided {@link CCloudStatusSummary}. */
export function updateCCloudStatus(status: CCloudStatusSummary) {
  // not accessing statusBarItem directly here because it may not be initialized yet when we fetch
  // any existing CCloud notices
  const item: StatusBarItem = getCCloudStatusBarItem();

  const activeIncidents: Incident[] = status.incidents.filter((incident) =>
    ACTIVE_INCIDENT_STATUS_ORDER.includes(incident.status),
  );
  const activeMaintenances: ScheduledMaintenance[] = status.scheduled_maintenances.filter(
    (maintenance) => ACTIVE_MAINTENANCE_STATUS_ORDER.includes(maintenance.status),
  );

  // only show the number of active incidents and maintenances if there are any
  item.text =
    `$(${IconNames.CONFLUENT_LOGO}) ${activeIncidents.length + activeMaintenances.length || ""}`.trim();

  // active incidents will use the error color; active maintenances will use the warning color
  // if both are present, the error color will take precedence
  item.backgroundColor = activeIncidents.length
    ? new ThemeColor(ERROR_BACKGROUND_COLOR_ID)
    : activeMaintenances.length
      ? new ThemeColor(WARNING_BACKGROUND_COLOR_ID)
      : undefined;

  item.tooltip = createStatusSummaryMarkdown(status);
}
