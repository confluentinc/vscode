import { randomUUID } from "crypto";
import { CCloudOrganization } from "../../../src/models/organization";
import { OrganizationId } from "../../../src/models/resource";

export const TEST_CCLOUD_ORGANIZATION = CCloudOrganization.create({
  id: randomUUID() as OrganizationId,
  current: true,
  name: "test-ccloud-org",
  jit_enabled: false,
});
