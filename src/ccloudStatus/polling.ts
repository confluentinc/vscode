import { MarkdownString } from "vscode";
import { Logger } from "../logging";
import { updateCCloudStatus } from "../statusBar/ccloudItem";
import { CCloudNotice } from "../statusBar/types";
import { titleCase } from "../utils";
import { IntervalPoller } from "../utils/timing";
import { fetchCCloudStatus } from "./api";
import { CCloudStatusSummary, Incident, ScheduledMaintenance, StatusUpdate } from "./types";

const logger = new Logger("ccloudStatus.polling");

let statusPoller: IntervalPoller | undefined;

/** Starts polling the Confluent Cloud status page for the latest summary every 5 minutes. */
export function enableCCloudStatusPolling() {
  if (!statusPoller) {
    statusPoller = new IntervalPoller(
      "ccloudStatus",
      async () => await refreshCCloudStatus(),
      1000 * 60 * 5, // every 5 minutes
      1000 * 60, // every 1 minute
      true, // start immediately
    );
  }
  statusPoller?.start();
}

/** Stops polling the Confluent Cloud status page. (Called when the extension is deactivated.) */
export function disableCCloudStatusPolling() {
  statusPoller?.stop();
  if (statusPoller) {
    statusPoller = undefined;
  }
}

/**
 * Fetches the latest CCloud status summary from the Statuspage API and converts it to an array of
 * {@link CCloudNotice} for displaying in the CCloud status bar item.
 */
export async function refreshCCloudStatus() {
  logger.debug("checking CCloud status...");
  const status: CCloudStatusSummary | undefined = await fetchCCloudStatus();
  if (!status) {
    logger.error("failed to fetch status summary; not refreshing status bar item");
    return;
  }

  logger.debug("parsing CCloud status for status bar item update...");
  const notices: CCloudNotice[] = convertStatusToNotices(status);
  logger.debug("converted status summary", {
    numIncidents: notices.filter((n) => n.type === "incident").length,
    numMaintenances: notices.filter((n) => n.type === "maintenance").length,
  });
  // update the status bar item with the latest incidents/maintenance notices
  updateCCloudStatus(notices);
  logger.debug("CCloud status bar item updated");
}

/**
 * Converts a {@link CCloudStatusSummary} object to an array of {@link CCloudNotice} for displaying in
 * the CCloud status bar item.
 */
export function convertStatusToNotices(status: CCloudStatusSummary): CCloudNotice[] {
  const notices: CCloudNotice[] = [];

  if (status.incidents) {
    status.incidents.forEach((incident: Incident) => {
      notices.push({
        type: "incident",
        message: formatStatusUpdate(incident),
      });
    });
  }

  if (status.scheduled_maintenances) {
    status.scheduled_maintenances.forEach((maintenance: ScheduledMaintenance) => {
      notices.push({
        type: "maintenance",
        message: formatStatusUpdate(maintenance),
      });
    });
  }

  return notices;
}

/** Creates a markdown formatted string for an {@link Incident} or {@link ScheduledMaintenance}. */
export function formatStatusUpdate(item: Incident | ScheduledMaintenance): string {
  let message = new MarkdownString(`[${item.name}](${item.shortlink})`);

  const latestUpdate: StatusUpdate | undefined = item.incident_updates
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .shift();
  if (latestUpdate) {
    const date = new Date(latestUpdate.updated_at);
    // e.g. "Jan 01, 12:00 UTC" similar to https://status.confluent.cloud/
    const dateStr = !isNaN(date.getTime())
      ? date.toLocaleString("en-US", {
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        })
      : "Unknown date";
    message.appendMarkdown(
      `\n   - _${dateStr} UTC_: **${titleCase(latestUpdate.status)}** - ${latestUpdate.body}`,
    );
  }

  return message.value;
}
