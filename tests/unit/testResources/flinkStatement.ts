import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../../src/constants";
import {
  FlinkStatement,
  FlinkStatementStatus,
  FlinkTraits,
} from "../../../src/models/flinkStatement";
import { EnvironmentId } from "../../../src/models/resource";
import { TEST_CCLOUD_ENVIRONMENT_ID } from "./environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL_ID } from "./flinkComputePool";

export const TEST_CCLOUD_FLINK_STATEMENT = createFlinkStatement();

export interface CreateFlinkStatementArgs {
  name?: string;
  phase?: string;
  detail?: string;
  sqlKind?: string;

  environmentId?: EnvironmentId;
  computePoolId?: string;
}

export function createFlinkStatement(overrides: CreateFlinkStatementArgs = {}): FlinkStatement {
  return new FlinkStatement({
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    environmentId: overrides.environmentId || TEST_CCLOUD_ENVIRONMENT_ID,
    computePoolId: overrides.computePoolId || TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
    name: overrides.name || "statement0",

    status: new FlinkStatementStatus({
      phase: overrides.phase || "RUNNING",
      detail: overrides.detail || "Running",
      traits: new FlinkTraits({
        sqlKind: overrides.sqlKind || "SELECT",
        bounded: true,
        appendOnly: true,
        schema: {},
      }),
      scalingStatus: {},
    }),
    ...overrides,
  });
}
