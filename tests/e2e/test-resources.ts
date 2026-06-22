/**
 * Non-secret CCloud resource identifiers for the E2E test environment.
 *
 * These live in source (not Vault) on purpose: they aren't sensitive, and routing changes through
 * a pull request gives us review and history when the test environment is re-provisioned or
 * renamed. Only the test user's credentials are sensitive; those stay on the `E2E_USERNAME` /
 * `E2E_PASSWORD` env vars (and the `E2E_KAFKA_*` / `E2E_SR_*` keys for direct connections).
 *
 * Most tests just need *a* working resource and use the `*_NAME` defaults below. Tests that
 * exercise provider-specific paths (e.g. Flink artifact upload per cloud/region) look one up by
 * provider/region with {@link findCCloudResource}.
 */

/** A CCloud resource in the test environment. `provider`/`region` are set for resources selected
 * by cloud provider/region; resource names are unique within the environment. */
export interface CCloudResource {
  name: string;
  provider?: string;
  region?: string;
}

export const CCLOUD_ENVIRONMENT_NAME = "vscode-test-env";

/** Kafka clusters in {@link CCLOUD_ENVIRONMENT_NAME}, one per cloud provider/region. */
export const CCLOUD_KAFKA_CLUSTERS: CCloudResource[] = [
  { name: "aws-cluster", provider: "AWS", region: "us-east-2" },
  { name: "azure-cluster", provider: "AZURE", region: "eastus" },
  { name: "gcp-cluster", provider: "GCP", region: "us-west2" },
];

/** Flink compute pools in {@link CCLOUD_ENVIRONMENT_NAME}, one per cloud provider/region. */
export const CCLOUD_FLINK_COMPUTE_POOLS: CCloudResource[] = [
  { name: "aws-pool", provider: "AWS", region: "us-east-2" },
  { name: "azure-pool", provider: "AZURE", region: "eastus" },
  { name: "gcp-pool", provider: "GCP", region: "us-west2" },
];

/** Default "any available" Kafka cluster for tests that don't care about provider/region. */
export const CCLOUD_KAFKA_CLUSTER_NAME = CCLOUD_KAFKA_CLUSTERS[0].name;
/** Default "any available" Flink compute pool for tests that don't care about provider/region. */
export const CCLOUD_FLINK_COMPUTE_POOL_NAME = CCLOUD_FLINK_COMPUTE_POOLS[0].name;

/** Finds the resource for a given cloud `provider`/`region` in `resources`. */
export function findCCloudResource(
  resources: CCloudResource[],
  provider: string,
  region: string,
): CCloudResource {
  const match = resources.find((r) => r.provider === provider && r.region === region);
  if (!match) {
    throw new Error(
      `[E2E] no CCloud resource configured for ${provider}/${region} in tests/e2e/test-resources.ts`,
    );
  }
  return match;
}
