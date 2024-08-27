import { graphql } from "gql.tada";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { CCloudOrganization } from "../models/organization";
import { getSidecar } from "../sidecar";

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
  const response = await sidecar.query(query, CCLOUD_CONNECTION_ID, { id: CCLOUD_CONNECTION_ID });
  if (response.ccloudConnectionById?.organizations) {
    response.ccloudConnectionById.organizations.forEach((org: any) => {
      orgResponse.push(CCloudOrganization.create(org));
    });
  }

  return orgResponse;
}

export async function getCurrentOrganization(): Promise<CCloudOrganization | undefined> {
  const orgs = await getOrganizations();
  return orgs.find((org) => org.current);
}
