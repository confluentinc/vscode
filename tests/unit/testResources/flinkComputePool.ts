import { CCloudFlinkComputePool } from "../../../src/models/flinkComputePool";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
} from "./environments";

export const TEST_CCLOUD_FLINK_COMPUTE_POOL = new CCloudFlinkComputePool({
  id: "lfcp-123",
  name: "Test Flink Pool",
  provider: TEST_CCLOUD_PROVIDER,
  region: TEST_CCLOUD_REGION,
  maxCfu: 10,
  environmentId: TEST_CCLOUD_ENVIRONMENT_ID,
} as CCloudFlinkComputePool);
