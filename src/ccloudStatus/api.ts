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
    const fetchError: boolean = error instanceof TypeError && error.message === "fetch failed";
    const jsonError: boolean =
      error instanceof SyntaxError && error.message.includes("Unexpected token");
    // only send to Sentry if it's not a fetch or JSON parsing error, but still log it
    let sentryContext: Record<string, unknown> = {};
    if (!fetchError && !jsonError) {
      sentryContext = {
        extra: { functionName: "fetchCCloudStatus" },
      };
    }
    logError(error, "CCloud status", sentryContext);
  }
}
