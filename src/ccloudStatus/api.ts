import { logError } from "../errors";
import { CCloudStatus, CCloudStatusFromJSON } from "./types";

const CCLOUD_STATUS_API_URL = "https://status.confluent.cloud/api/v2/summary.json";

/** Fetches the current Confluent Cloud status from the public Statuspage API. */
export async function fetchCCloudStatus(): Promise<CCloudStatus | undefined> {
  try {
    const response = await fetch(CCLOUD_STATUS_API_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Confluent Cloud status: ${response.status} ${response.statusText}`,
      );
    }
    const data = await response.json();
    return CCloudStatusFromJSON(data);
  } catch (error) {
    logError(error, "CCloud status", {}, true);
  }
}
