import { MarkdownString, StatusBarAlignment, StatusBarItem, ThemeColor, window } from "vscode";
import { CustomMarkdownString } from "../models/main";
import { CCloudNotice } from "./types";

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
  statusBarItem.text = "$(confluent-logo)";
  statusBarItem.show();

  return statusBarItem;
}

/** Updates the `text`, `tooltip`, and (optionally) `backgroundColor` of the Confluent Cloud status
 * bar item based on the provided array of {@link CCloudNotice}. */
export function updateCCloudStatus(notices: CCloudNotice[]) {
  // not accessing statusBarItem directly here because it may not be initialized yet when we fetch
  // any existing CCloud notices
  const item: StatusBarItem = getCCloudStatusBarItem();

  item.text = `$(confluent-logo) ${notices.length ? notices.length : ""}`.trim();
  item.tooltip = createNoticesMarkdown(notices);
  item.backgroundColor = determineStatusBarColor(notices);
}

/** Returns a {@link MarkdownString} for the status bar item tooltip based on the provided array of
 * {@link CCloudNotice}. */
export function createNoticesMarkdown(notices: CCloudNotice[]): MarkdownString {
  if (!notices.length) {
    return new MarkdownString("No notices for Confluent Cloud at this time.");
  }

  // header section
  let tooltipMarkdown: MarkdownString = new CustomMarkdownString(
    `#### $(confluent-logo) Confluent Cloud: ${notices.length} notice${notices.length === 1 ? "" : "s"}`,
  ).appendMarkdown("\n\n---\n\n");

  // associate each notice `level` to a user-facing label and icon
  const categories = [
    { type: "incident", label: "Incidents" },
    { type: "maintenance", label: "Scheduled Maintenance" },
    // no "info" level notices for now, but if we add them in the future, we can use this
  ];

  for (const category of categories) {
    const categoryNotices = notices.filter((notice) => notice.type === category.type);
    if (!categoryNotices.length) {
      continue;
    }

    tooltipMarkdown.appendMarkdown(`\n### ${category.label}\n`);
    categoryNotices.forEach((notice) => {
      if (!notice.message) {
        return;
      }
      let noticeMessage = `\n- ${notice.message}`;
      tooltipMarkdown.appendMarkdown(noticeMessage);
    });
  }

  // footer section
  tooltipMarkdown.appendMarkdown("\n\n---\n\n");
  tooltipMarkdown.appendMarkdown(
    "Click to view the [Confluent Cloud Status](https://status.confluent.cloud/) page for more details.",
  );
  return tooltipMarkdown;
}

/** Returns a {@link ThemeColor} for the status bar item based on the provided array of
 * {@link CCloudNotice}.
 *
 * If there are no notices, this will return `undefined`.
 */
export function determineStatusBarColor(notices: CCloudNotice[]): ThemeColor | undefined {
  if (!notices.length) {
    return;
  }

  const incidentNotices = notices.some((notice) => notice.type === "incident");
  if (incidentNotices) {
    return new ThemeColor("statusBarItem.errorBackground");
  }

  const maintenanceNotices = notices.some((notice) => notice.type === "maintenance");
  if (maintenanceNotices) {
    return new ThemeColor("statusBarItem.warningBackground");
  }
}
