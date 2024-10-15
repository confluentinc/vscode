import { graphql } from "gql.tada";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { Logger } from "../logging";
import { CCloudOrganization } from "../models/organization";
import { getSidecar } from "../sidecar";

const logger = new Logger("graphql.organizations");

export async function getOrganizations(): Promise<CCloudOrganization[]> {
  let orgResponse: CCloudOrganization[] = [];

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

  try {
    const response = await sidecar.query(query, CCLOUD_CONNECTION_ID, { id: CCLOUD_CONNECTION_ID });
    if (response.ccloudConnectionById?.organizations) {
      response.ccloudConnectionById.organizations.forEach((org: any) => {
        try {
          orgResponse.push(CCloudOrganization.create(org));
        } catch (e) {
          logger.error("Failed to create organization:", e);
        }
      });
    }
  } catch (e) {
    logger.error("Failed to fetch organizations:", e);
  }

  return orgResponse;
}

export async function getCurrentOrganization(): Promise<CCloudOrganization | undefined> {
  const orgs = await getOrganizations();
  return orgs.find((org) => org.current);
}
