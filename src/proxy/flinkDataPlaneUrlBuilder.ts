/**
 * Flink Data Plane URL Builder.
 *
 * Utilities for constructing Flink SQL API URLs based on provider and region.
 */

import { CCLOUD_BASE_PATH } from "../constants";
import { CCLOUD_PRIVATE_NETWORK_ENDPOINTS } from "../extensionSettings/constants";
import { Logger } from "../logging";
import { resolvePrivateEndpoint } from "../flinkSql/privateEndpointResolver";

const logger = new Logger("proxy.flinkDataPlaneUrlBuilder");

/**
 * Builds the Flink SQL Data Plane API base URL for a given provider and region.
 *
 * The Flink SQL API uses regional endpoints in the format:
 * https://fpsdk.{region}.{provider}.confluent.cloud
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
      // Transform the private endpoint to Flink SQL API format
      // E.g., https://flink.us-west-2.aws.private.confluent.cloud
      // -> https://fpsdk.us-west-2.aws.private.confluent.cloud
      const transformedUrl = transformFlinkEndpointToFpsdk(privateEndpoint);
      if (transformedUrl) {
        logger.debug("Using private Flink Data Plane endpoint", {
          environmentId,
          privateEndpoint,
          transformedUrl,
        });
        return transformedUrl;
      }
    }
  }

  // Use the standard public URL pattern
  const baseDomain = CCLOUD_BASE_PATH === "confluent.cloud" ? "confluent.cloud" : CCLOUD_BASE_PATH;
  return `https://fpsdk.${region}.${provider}.${baseDomain}`;
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

/**
 * Transforms a Flink endpoint URL to an FPSDK URL.
 * Flink endpoints like https://flink.us-west-2.aws.private.confluent.cloud
 * become https://fpsdk.us-west-2.aws.private.confluent.cloud
 *
 * @param flinkEndpoint The Flink endpoint URL.
 * @returns The transformed FPSDK URL or null if transformation failed.
 */
function transformFlinkEndpointToFpsdk(flinkEndpoint: string): string | null {
  const resolved = resolvePrivateEndpoint(flinkEndpoint);
  if (!resolved) {
    // Try direct transformation for unknown formats
    try {
      const url = new URL(flinkEndpoint);
      // Replace "flink" with "fpsdk" in the hostname
      if (url.hostname.startsWith("flink.") || url.hostname.startsWith("flink-")) {
        url.hostname = url.hostname.replace(/^flink([.-])/, "fpsdk$1");
        return url.origin;
      }
    } catch {
      logger.warn("Failed to parse Flink endpoint URL", { flinkEndpoint });
    }
    return null;
  }

  // Use the resolved endpoint's info to build FPSDK URL
  // Replace "flinkpls" with "fpsdk" in the LSP URL
  const fpsdkUrl = resolved.lspUrl
    .replace("wss://", "https://")
    .replace("flinkpls", "fpsdk")
    .replace("/lsp", "");

  return fpsdkUrl;
}
