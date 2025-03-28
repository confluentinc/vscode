import { Logger } from "../logging";
import { updateCCloudStatus } from "../statusBar/ccloudItem";
import { IntervalPoller } from "../utils/timing";
import { fetchCCloudStatus } from "./api";
import { CCloudStatusSummary } from "./types";

const logger = new Logger("ccloudStatus.polling");

let statusPoller: IntervalPoller | undefined;

/** Starts polling the Confluent Cloud status page for the latest summary every 2 minutes. */
export function enableCCloudStatusPolling() {
  if (!statusPoller) {
    statusPoller = new IntervalPoller(
      "ccloudStatus",
      async () => await refreshCCloudStatus(),
      1000 * 60 * 2, // every 2 minutes
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
    logger.debug("failed to fetch status summary; not refreshing status bar item");
    return;
  }

  logger.debug("parsing CCloud status for status bar item update...", {
    numIncidents: status.incidents.length,
    numMaintenances: status.scheduled_maintenances.length,
  });
  const notices: CCloudNotice[] = convertStatusToNotices(status);
  logger.debug("converted status summary", {
    numIncidents: notices.filter((n) => n.type === "incident").length,
    numMaintenances: notices.filter((n) => n.type === "maintenance").length,
  });
  // update the status bar item with the latest incidents/maintenance notices
  updateCCloudStatus(status);
  logger.debug("CCloud status bar item updated");
}
