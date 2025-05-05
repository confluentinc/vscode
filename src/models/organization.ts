import { Data, type Require as Enforced } from "dataclass";
import { OrganizationId } from "./resource";

export class CCloudOrganization extends Data {
  id!: Enforced<OrganizationId>;
  name!: Enforced<string>;
  current!: Enforced<boolean>;
  jit_enabled!: Enforced<boolean>;
}
