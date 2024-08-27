import { Data, type Require as Enforced } from "dataclass";

export class CCloudOrganization extends Data {
  id!: Enforced<string>;
  name!: Enforced<string>;
  current!: Enforced<boolean>;
  jit_enabled!: Enforced<boolean>;
}
