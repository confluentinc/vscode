import { logError } from "../errors";
import { CCloudStatusSummary, CCloudStatusSummaryFromJSON } from "./types";

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
    if (error instanceof TypeError && error.message === "fetch failed") {
      return; // network error
    }
    logError(error, "CCloud status", {}, true);
  }
}
