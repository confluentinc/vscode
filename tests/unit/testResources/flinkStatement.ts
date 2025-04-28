import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../../src/constants";
import {
  FlinkStatement,
} from "../../../src/models/flinkStatement";
import { EnvironmentId, OrganizationId } from "../../../src/models/resource";
import { TEST_CCLOUD_ENVIRONMENT_ID } from "./environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL_ID } from "./flinkComputePool";
import { TEST_CCLOUD_ORGANIZATION } from "./organization";

export const TEST_CCLOUD_FLINK_STATEMENT = createFlinkStatement();

export interface CreateFlinkStatementArgs {
  name?: string;
  phase?: string;
  detail?: string;
  sqlKind?: string;
  sqlStatement?: string;

  environmentId?: EnvironmentId;
  organizationId?: OrganizationId;
  computePoolId?: string;
}

export function createFlinkStatement(overrides: CreateFlinkStatementArgs = {}): FlinkStatement {
  return new FlinkStatement({
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    environmentId: overrides.environmentId || TEST_CCLOUD_ENVIRONMENT_ID,
    organizationId: overrides.organizationId || TEST_CCLOUD_ORGANIZATION.id,
    name: overrides.name || "statement0",
    metadata: {
      self: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
    status: {
      phase: overrides.phase || "RUNNING",
      detail: overrides.detail || "Running",
      traits: {
        sql_kind: overrides.sqlKind || "SELECT",
        is_bounded: true,
        is_append_only: true,
        schema: {},
      },
      scaling_status: {}
    },
    spec: {
      compute_pool_id: overrides.computePoolId || TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
      statement: overrides.sqlStatement || "SELECT * FROM test_table",
      principal: "test-principal",
      authorized_principals: [],
      properties: {
        "sql.current-catalog": "custom-data-env",
        "sql.current-database": "Custom Data Dedicated Replica",
        "sql.local-time-zone": "GMT-04:00",
      },
      stopped: false,
    },
  });
}
