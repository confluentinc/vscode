/**
 * Flink Data Plane URL Builder.
 *
 * Utilities for constructing Flink SQL API URLs based on provider and region.
 */

import { CCLOUD_BASE_PATH } from "../constants";
import { CCLOUD_PRIVATE_NETWORK_ENDPOINTS } from "../extensionSettings/constants";
import { Logger } from "../logging";

const logger = new Logger("proxy.flinkDataPlaneUrlBuilder");

/**
 * Builds the Flink SQL Data Plane API base URL for a given provider and region.
 *
 * The Flink SQL API uses regional endpoints in the format:
 * https://flink.{region}.{provider}.confluent.cloud
 *
 * @param provider Cloud provider (e.g., "aws", "gcp", "azure").
 * @param region Cloud region (e.g., "us-west-2", "us-central1").
 * @param environmentId Optional environment ID for private endpoint lookup.
 * @returns The Flink SQL API base URL.
 */
export function buildFlinkDataPlaneBaseUrl(
  provider: string,
  region: string,
  environmentId?: string,
): string {
  // Check for private endpoint configuration for this environment
  if (environmentId) {
    const privateEndpoint = getFlinkPrivateEndpoint(environmentId);
    if (privateEndpoint) {
      logger.debug("Using private Flink Data Plane endpoint", {
        environmentId,
        privateEndpoint,
      });
      return privateEndpoint;
    }
  }

  // Use the standard public URL pattern
  // Provider must be lowercase for the URL (e.g., "gcp" not "GCP")
  const baseDomain = CCLOUD_BASE_PATH === "confluent.cloud" ? "confluent.cloud" : CCLOUD_BASE_PATH;
  return `https://flink.${region}.${provider.toLowerCase()}.${baseDomain}`;
}

/**
 * Gets the Flink private endpoint URL for an environment, if configured.
 * @param environmentId Environment ID to check.
 * @returns Private Flink endpoint URL or null if not configured.
 */
function getFlinkPrivateEndpoint(environmentId: string): string | null {
  const privateEndpoints = CCLOUD_PRIVATE_NETWORK_ENDPOINTS.value;
  if (!privateEndpoints) {
    return null;
  }

  for (const key of Object.keys(privateEndpoints)) {
    const envId = key.split(" (")[0];
    if (envId === environmentId) {
      const endpointString = privateEndpoints[key];
      const endpoints = endpointString
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Find a Flink endpoint in the list
      for (const endpoint of endpoints) {
        if (endpoint.toLowerCase().includes("flink")) {
          return endpoint;
        }
      }
    }
  }

  return null;
}
