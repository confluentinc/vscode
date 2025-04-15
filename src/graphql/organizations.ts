import { graphql } from "gql.tada";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { logError, showErrorNotificationWithButtons } from "../errors";
import { Logger } from "../logging";
import { CCloudOrganization } from "../models/organization";
import { getSidecar } from "../sidecar";

const logger = new Logger("graphql.organizations");

export async function getOrganizations(): Promise<CCloudOrganization[]> {
  let orgs: CCloudOrganization[] = [];

  const query = graphql(`
    query connectionById($id: String!) {
      ccloudConnectionById(id: $id) {
        organizations {
          id
          name
          current
        }
      }
    }
  `);

  const sidecar = await getSidecar();
  let response;
  try {
    response = await sidecar.query(query, CCLOUD_CONNECTION_ID, { id: CCLOUD_CONNECTION_ID });
  } catch (error) {
    logError(error, "CCloud organizations", { extra: { connectionId: CCLOUD_CONNECTION_ID } });
    showErrorNotificationWithButtons(`Failed to fetch CCloud organizations: ${error}`);
    return orgs;
  }

  if (response.ccloudConnectionById?.organizations) {
    response.ccloudConnectionById.organizations.forEach((org: any) => {
      try {
        orgs.push(CCloudOrganization.create(org));
      } catch (e) {
        logger.error("Failed to create organization:", e);
      }
    });
  }

  return orgs;
}

/** Perform a deep GraphQL fetch for all organizations, then return the one marked current. */
export async function getCurrentOrganization(): Promise<CCloudOrganization | undefined> {
  const orgs = await getOrganizations();
  return orgs.find((org) => org.current);
}
