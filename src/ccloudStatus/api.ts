import { logError } from "../errors";
import { withRequestTimeout } from "../utils/timing";
import type { CCloudStatusSummary } from "./types";
import { CCloudStatusSummaryFromJSON } from "./types";

const CCLOUD_STATUS_API_URL = "https://status.confluent.cloud/api/v2/summary.json";
/** A status check is a nicety, so give up quickly rather than hold a request open. */
export const STATUSPAGE_TIMEOUT_MS = 10_000;

/** Fetches the current Confluent Cloud status from the public Statuspage Status API. */
export async function fetchCCloudStatus(): Promise<CCloudStatusSummary | undefined> {
  try {
    const data = await withRequestTimeout(
      "Fetching Confluent Cloud status",
      STATUSPAGE_TIMEOUT_MS,
      async (signal) => {
        const response = await fetch(CCLOUD_STATUS_API_URL, { signal });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch Confluent Cloud status: ${response.status} ${response.statusText}`,
          );
        }
        return await response.json();
      },
    );
    return CCloudStatusSummaryFromJSON(data);
  } catch (error) {
    // don't send these to Sentry since any network errors or Statuspage service issues are out of
    // our control, and at worst mean the status bar item won't show the latest status
    logError(error, "CCloud status");
  }
}
