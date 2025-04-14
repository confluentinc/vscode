import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../../src/constants";
import { FlinkStatement } from "../../../src/models/flinkStatement";
import { TEST_CCLOUD_ENVIRONMENT_ID } from "./environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL_ID } from "./flinkComputePool";

export const TEST_CCLOUD_FLINK_STATEMENT = new FlinkStatement({
  connectionId: CCLOUD_CONNECTION_ID,
  connectionType: ConnectionType.Ccloud,
  environmentId: TEST_CCLOUD_ENVIRONMENT_ID,
  computePoolId: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
  id: "statement0",
  status: "RUNNING",
} as FlinkStatement);
