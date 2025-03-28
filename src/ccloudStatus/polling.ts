import { MarkdownString } from "vscode";
import { updateCCloudStatus } from "../statusBar/ccloudItem";
import { CCloudNotice } from "../statusBar/types";
import { titleCase } from "../utils";
import { IntervalPoller } from "../utils/timing";
import { fetchCCloudStatus } from "./api";
import { CCloudStatusSummary, Incident, ScheduledMaintenance, StatusUpdate } from "./types";

let statusPoller: IntervalPoller | undefined;

export function enableCCloudStatusPolling() {
  if (!statusPoller) {
    statusPoller = new IntervalPoller(
      "ccloudStatus",
      () => refreshCCloudStatus(),
      1000 * 60 * 5, // every 5 minutes
      1000 * 60, // every 1 minute
      true, // start immediately
    );
  }
  statusPoller?.start();
}

export function disableCCloudStatusPolling() {
  statusPoller?.stop();
  if (statusPoller) {
    statusPoller = undefined;
  }
}

export async function refreshCCloudStatus() {
  const status: CCloudStatusSummary | undefined = await fetchCCloudStatus();
  if (!status) {
    return;
  }

  const notices: CCloudNotice[] = convertStatusToNotices(status);
  // update the status bar item with the latest incidents/maintenance notices
  updateCCloudStatus(notices);
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

export function formatStatusUpdate(item: Incident | ScheduledMaintenance): string {
  let message = new MarkdownString(`[${item.name}](${item.shortlink})`);

  const latestUpdate: StatusUpdate | undefined = item.incident_updates
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .shift();
  if (latestUpdate) {
    const dateStr = new Date(latestUpdate.display_at).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    message.appendMarkdown(
      `\n   - _${dateStr} UTC_: **${titleCase(latestUpdate.status)}** - ${latestUpdate.body}`,
    );
  }

  return message.value;
}
