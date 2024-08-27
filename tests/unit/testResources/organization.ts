import { randomUUID } from "crypto";
import { CCloudOrganization } from "../../../src/models/organization";

export const TEST_CCLOUD_ORGANIZATION = CCloudOrganization.create({
  id: randomUUID(),
  current: true,
  name: "test-ccloud-org",
  jit_enabled: false,
});
