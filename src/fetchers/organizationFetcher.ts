/**
 * Organization Fetcher.
 *
 * Fetches CCloud organization information using direct API calls
 * instead of GraphQL queries through the sidecar.
 */

import { TokenManager } from "../authn/oauth2/tokenManager";
import { logError } from "../errors";
import { Logger } from "../logging";
import { CCloudOrganization } from "../models/organization";
import type { OrganizationId } from "../models/resource";
import { showErrorNotificationWithButtons } from "../notifications";
import {
  CCloudControlPlaneProxy,
  type CCloudOrganization as CCloudOrgData,
} from "../proxy/ccloudControlPlaneProxy";

const logger = new Logger("fetchers.organizationFetcher");

/** Cached current organization ID (in-memory for the session). */
let cachedCurrentOrgId: OrganizationId | undefined;

/**
 * Fetches all organizations the current user has access to.
 * @returns Array of CCloudOrganization objects.
 */
export async function getOrganizations(): Promise<CCloudOrganization[]> {
  const orgs: CCloudOrganization[] = [];

  // Get the control plane token from TokenManager
  const tokenManager = TokenManager.getInstance();
  const token = await tokenManager.getControlPlaneToken();
  if (!token) {
    logger.debug("No control plane token, cannot fetch organizations");
    return orgs;
  }

  try {
    // Note: CCloud resource APIs use confluent.cloud, not api.confluent.cloud
    const proxy = new CCloudControlPlaneProxy({
      baseUrl: "https://confluent.cloud",
      auth: { type: "bearer", token },
    });

    const orgDataList = await proxy.fetchAllOrganizations();

    // If we don't have a cached current org and there's only one org, set it as current
    if (!cachedCurrentOrgId && orgDataList.length === 1) {
      cachedCurrentOrgId = orgDataList[0].id as OrganizationId;
    }

    for (const orgData of orgDataList) {
      try {
        const org = convertToOrganizationModel(orgData, cachedCurrentOrgId);
        orgs.push(org);
      } catch (e) {
        logger.error("Failed to create organization:", e);
      }
    }

    // If we still don't have a current org set, use the first one
    if (!cachedCurrentOrgId && orgs.length > 0) {
      cachedCurrentOrgId = orgs[0].id;
      orgs[0] = CCloudOrganization.create({
        ...orgs[0],
        current: true,
      });
    }
  } catch (error) {
    logError(error, "CCloud organizations fetch failed");
    void showErrorNotificationWithButtons(`Failed to fetch CCloud organizations: ${error}`);
  }

  return orgs;
}

/**
 * Gets the current (selected) organization.
 *
 * If there's only one organization, it's automatically current.
 * If there are multiple orgs, the first one is used by default.
 * @returns The current CCloudOrganization, or undefined if not found.
 */
export async function getCurrentOrganization(): Promise<CCloudOrganization | undefined> {
  const orgs = await getOrganizations();
  return orgs.find((org) => org.current) ?? orgs[0];
}

/**
 * Sets the current organization ID.
 * @param orgId The organization ID to set as current.
 */
export function setCurrentOrganizationId(orgId: OrganizationId): void {
  cachedCurrentOrgId = orgId;
  logger.debug("Set current organization", { orgId });
}

/**
 * Clears the cached current organization (e.g., on sign out).
 */
export function clearCurrentOrganization(): void {
  cachedCurrentOrgId = undefined;
  logger.debug("Cleared current organization");
}

/**
 * Converts CCloud API organization data to our model.
 */
function convertToOrganizationModel(
  data: CCloudOrgData,
  currentOrgId?: OrganizationId,
): CCloudOrganization {
  return CCloudOrganization.create({
    id: data.id as OrganizationId,
    name: data.display_name || data.id,
    current: data.id === currentOrgId,
    jit_enabled: data.jit_enabled ?? false,
  });
}
