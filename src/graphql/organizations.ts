import { graphql } from "gql.tada";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { logResponseError, showErrorNotificationWithButtons } from "../errors";
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
    logResponseError(error, "CCloud organizations", { connectionId: CCLOUD_CONNECTION_ID }, true);
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

export async function getCurrentOrganization(): Promise<CCloudOrganization | undefined> {
  const orgs = await getOrganizations();
  return orgs.find((org) => org.current);
}
