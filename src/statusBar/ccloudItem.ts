import { StatusBarAlignment, StatusBarItem, ThemeColor, window } from "vscode";
import { CCloudStatusSummary, Incident, ScheduledMaintenance } from "../ccloudStatus/types";
import { IconNames } from "../constants";
import { ERROR_BACKGROUND_COLOR_ID, WARNING_BACKGROUND_COLOR_ID } from "./constants";
import { createStatusSummaryMarkdown } from "./formatting";

let statusBarItem: StatusBarItem | undefined;

/** Creates, shows, and returns a Confluent Cloud {@link StatusBarItem} singleton. */
export function getCCloudStatusBarItem(): StatusBarItem {
  if (statusBarItem) {
    return statusBarItem;
  }

  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left);

  statusBarItem.name = "Confluent Cloud Notices";
  statusBarItem.command = {
    command: "vscode.open",
    title: "Open Confluent Cloud Status",
    arguments: ["https://status.confluent.cloud/"],
  };
  statusBarItem.text = `$(${IconNames.CONFLUENT_LOGO})`;
  statusBarItem.show();

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

  const activeIncidents: Incident[] = status.incidents.filter(
    (incident) => incident.status !== "resolved",
  );
  const activeMaintenances: ScheduledMaintenance[] = status.scheduled_maintenances.filter(
    (maintenance) => maintenance.status !== "completed",
  );
  const noticeCount: number = activeIncidents.length + activeMaintenances.length;

  item.text = `$(${IconNames.CONFLUENT_LOGO}) ${noticeCount || ""}`.trim();
  item.backgroundColor = determineStatusBarColor(status);
  item.tooltip = createStatusSummaryMarkdown(status);
}

/**
 * Returns a {@link ThemeColor} for the status bar item based on the provided {@link CCloudStatusSummary}.
 *
 * If there are no incidents or scheduled maintenances, this will return `undefined` to reset the
 * status bar item color.
 */
export function determineStatusBarColor(summary: CCloudStatusSummary): ThemeColor | undefined {
  if (!summary.incidents.length && !summary.scheduled_maintenances.length) {
    return;
  }

  if (summary.incidents.filter((incident) => incident.status !== "resolved").length) {
    return new ThemeColor(ERROR_BACKGROUND_COLOR_ID);
  }

  if (
    summary.scheduled_maintenances.filter((maintenance) => maintenance.status !== "completed")
      .length
  ) {
    return new ThemeColor(WARNING_BACKGROUND_COLOR_ID);
  }
}
