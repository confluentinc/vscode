import { logError } from "../errors";
import type { CCloudStatusSummary } from "./types";
import { CCloudStatusSummaryFromJSON } from "./types";

const CCLOUD_STATUS_API_URL = "https://status.confluent.cloud/api/v2/summary.json";

/** Fetches the current Confluent Cloud status from the public Statuspage Status API. */
export async function fetchCCloudStatus(): Promise<CCloudStatusSummary | undefined> {
  try {
    const response = await fetch(CCLOUD_STATUS_API_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Confluent Cloud status: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();
    return CCloudStatusSummaryFromJSON(data);
  } catch (error) {
    // don't send these to Sentry since any network errors or Statuspage service issues are out of
    // our control, and at worst mean the status bar item won't show the latest status
    logError(error, "CCloud status");
  }
}
