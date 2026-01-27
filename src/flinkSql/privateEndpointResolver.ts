/**
 * Private Endpoint Resolver for Flink LSP.
 *
 * Handles transformation of private endpoint URLs to Flink Language Service URLs.
 * Supports multiple private networking formats used by Confluent Cloud.
 */

import { CCLOUD_PRIVATE_NETWORK_ENDPOINTS } from "../extensionSettings/constants";
import { Logger } from "../logging";

const logger = new Logger("flinkSql.privateEndpointResolver");

/**
 * Supported private endpoint formats.
 */
export enum PrivateEndpointFormat {
  /** Standard PLATTC format: flink.{region}.{provider}.private.confluent.cloud */
  PLATTC = "PLATTC",
  /** CCN Domain format: flink.{domainId}.{region}.{provider}.confluent.cloud */
  CCN_DOMAIN = "CCN_DOMAIN",
  /** CCN GLB format: flink-{networkId}.{region}.{provider}.glb.confluent.cloud */
  CCN_GLB = "CCN_GLB",
  /** CCN Peering format: flink-{peeringId}.{region}.{provider}.confluent.cloud */
  CCN_PEERING = "CCN_PEERING",
  /** Public endpoint (no private networking) */
  PUBLIC = "PUBLIC",
}

/**
 * Result of endpoint detection and transformation.
 */
export interface ResolvedEndpoint {
  /** The original endpoint URL. */
  originalUrl: string;
  /** The detected format of the endpoint. */
  format: PrivateEndpointFormat;
  /** The transformed Flink LSP WebSocket URL. */
  lspUrl: string;
  /** The region extracted from the endpoint. */
  region: string;
  /** The cloud provider extracted from the endpoint. */
  provider: string;
}

/**
 * Pattern matchers for different private endpoint formats.
 *
 * Each pattern captures:
 * - For PLATTC: region, provider
 * - For CCN_DOMAIN: domainId, region, provider
 * - For CCN_GLB: networkId, region, provider
 * - For CCN_PEERING: peeringId, region, provider
 */
const ENDPOINT_PATTERNS: Array<{
  format: PrivateEndpointFormat;
  pattern: RegExp;
  buildLspUrl: (match: RegExpMatchArray) => string;
  extractRegionProvider: (match: RegExpMatchArray) => { region: string; provider: string };
}> = [
  {
    // PLATTC: https://flink.us-west-2.aws.private.confluent.cloud
    // -> wss://flinkpls.us-west-2.aws.private.confluent.cloud/lsp
    format: PrivateEndpointFormat.PLATTC,
    pattern: /^https?:\/\/flink\.([^.]+)\.([^.]+)\.private\.confluent\.cloud\/?$/i,
    buildLspUrl: (match) => `wss://flinkpls.${match[1]}.${match[2]}.private.confluent.cloud/lsp`,
    extractRegionProvider: (match) => ({ region: match[1], provider: match[2] }),
  },
  {
    // CCN Domain: https://flink.domid123.us-west-2.aws.confluent.cloud
    // -> wss://flinkpls.domid123.us-west-2.aws.confluent.cloud/lsp
    format: PrivateEndpointFormat.CCN_DOMAIN,
    pattern: /^https?:\/\/flink\.([^.]+)\.([^.]+)\.([^.]+)\.confluent\.cloud\/?$/i,
    buildLspUrl: (match) =>
      `wss://flinkpls.${match[1]}.${match[2]}.${match[3]}.confluent.cloud/lsp`,
    extractRegionProvider: (match) => ({ region: match[2], provider: match[3] }),
  },
  {
    // CCN GLB: https://flink-nid.us-west-2.aws.glb.confluent.cloud
    // -> wss://flinkpls-nid.us-west-2.aws.glb.confluent.cloud/lsp
    format: PrivateEndpointFormat.CCN_GLB,
    pattern: /^https?:\/\/flink-([^.]+)\.([^.]+)\.([^.]+)\.glb\.confluent\.cloud\/?$/i,
    buildLspUrl: (match) =>
      `wss://flinkpls-${match[1]}.${match[2]}.${match[3]}.glb.confluent.cloud/lsp`,
    extractRegionProvider: (match) => ({ region: match[2], provider: match[3] }),
  },
  {
    // CCN Peering: https://flink-peerid.us-west-2.aws.confluent.cloud
    // -> wss://flinkpls-peerid.us-west-2.aws.confluent.cloud/lsp
    format: PrivateEndpointFormat.CCN_PEERING,
    pattern: /^https?:\/\/flink-([^.]+)\.([^.]+)\.([^.]+)\.confluent\.cloud\/?$/i,
    buildLspUrl: (match) =>
      `wss://flinkpls-${match[1]}.${match[2]}.${match[3]}.confluent.cloud/lsp`,
    extractRegionProvider: (match) => ({ region: match[2], provider: match[3] }),
  },
];

/**
 * Detects the format of a private endpoint URL and returns the resolved endpoint.
 * @param url The private endpoint URL to analyze.
 * @returns The resolved endpoint with format and LSP URL, or null if not a recognized format.
 */
export function resolvePrivateEndpoint(url: string): ResolvedEndpoint | null {
  if (!url) {
    return null;
  }

  const normalizedUrl = url.trim();

  for (const { format, pattern, buildLspUrl, extractRegionProvider } of ENDPOINT_PATTERNS) {
    const match = normalizedUrl.match(pattern);
    if (match) {
      const { region, provider } = extractRegionProvider(match);
      return {
        originalUrl: normalizedUrl,
        format,
        lspUrl: buildLspUrl(match),
        region,
        provider,
      };
    }
  }

  logger.debug("URL does not match any known private endpoint format", { url: normalizedUrl });
  return null;
}

/**
 * Builds the public Flink LSP WebSocket URL.
 * @param region The cloud region (e.g., "us-west-2").
 * @param provider The cloud provider (e.g., "aws").
 * @returns The public Flink LSP WebSocket URL.
 */
export function buildPublicFlinkLspUrl(region: string, provider: string): string {
  return `wss://flinkpls.${region}.${provider}.confluent.cloud/lsp`;
}

/**
 * Builds the Flink LSP WebSocket URL, using private endpoints if configured.
 * @param environmentId The environment ID to check for private endpoint configuration.
 * @param region The cloud region.
 * @param provider The cloud provider.
 * @returns The Flink LSP WebSocket URL (private if configured, otherwise public).
 */
export function buildFlinkLspUrl(environmentId: string, region: string, provider: string): string {
  // Check for private endpoint configuration for this environment
  const privateEndpoints = CCLOUD_PRIVATE_NETWORK_ENDPOINTS.value;
  if (!privateEndpoints) {
    return buildPublicFlinkLspUrl(region, provider);
  }

  // Look for an endpoint configured for this environment
  // The keys may include environment name in parentheses, e.g., "env-id (env-name)"
  for (const key of Object.keys(privateEndpoints)) {
    const envId = key.split(" (")[0];
    if (envId === environmentId) {
      const endpointString = privateEndpoints[key];
      // The endpoint string may be comma-separated for multiple endpoints
      const endpoints = endpointString
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Find a Flink endpoint in the list
      for (const endpoint of endpoints) {
        if (endpoint.toLowerCase().includes("flink")) {
          const resolved = resolvePrivateEndpoint(endpoint);
          if (resolved) {
            logger.debug("Using private endpoint for Flink LSP", {
              environmentId,
              format: resolved.format,
              lspUrl: resolved.lspUrl,
            });
            return resolved.lspUrl;
          }
        }
      }
    }
  }

  // No private endpoint configured, use public URL
  return buildPublicFlinkLspUrl(region, provider);
}

/**
 * Gets the private endpoint URL configured for an environment, if any.
 * @param environmentId The environment ID to look up.
 * @returns The private endpoint URL or null if not configured.
 */
export function getPrivateEndpointForEnvironment(environmentId: string): string | null {
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

      // Find a Flink endpoint
      for (const endpoint of endpoints) {
        if (endpoint.toLowerCase().includes("flink")) {
          return endpoint;
        }
      }
    }
  }

  return null;
}
