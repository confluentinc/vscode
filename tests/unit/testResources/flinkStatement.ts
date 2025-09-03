import { SqlV1StatementStatus } from "../../../src/clients/flinkSql";
import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../../src/constants";
import { FlinkStatement, Phase } from "../../../src/models/flinkStatement";
import { EnvironmentId, OrganizationId } from "../../../src/models/resource";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_PROVIDER, TEST_CCLOUD_REGION } from "./environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL_ID } from "./flinkComputePool";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "./kafkaCluster";
import { TEST_CCLOUD_ORGANIZATION } from "./organization";

export const TEST_CCLOUD_FLINK_STATEMENT = createFlinkStatement();

export interface CreateFlinkStatementArgs {
  name?: string;
  phase?: Phase;
  detail?: string;
  sqlKind?: string;
  sqlStatement?: string;

  environmentId?: EnvironmentId;
  organizationId?: OrganizationId;
  computePoolId?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export function createFlinkStatement(overrides: CreateFlinkStatementArgs = {}): FlinkStatement {
  return new FlinkStatement({
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    environmentId: overrides.environmentId || TEST_CCLOUD_ENVIRONMENT.id,
    organizationId: overrides.organizationId || TEST_CCLOUD_ORGANIZATION.id,
    provider: TEST_CCLOUD_PROVIDER,
    region: TEST_CCLOUD_REGION,

    name: overrides.name || "statement0",

    metadata: {
      self: null,
      created_at: overrides.createdAt || new Date(),
      updated_at: overrides.updatedAt || new Date(),
    },
    status: {
      phase: (overrides.phase as string) || Phase.RUNNING,
      detail: overrides.detail || "Running",
      traits: {
        sql_kind: overrides.sqlKind || "SELECT",
        is_bounded: true,
        is_append_only: true,
        schema: {},
      },
      scaling_status: {},
    },
    spec: {
      compute_pool_id: overrides.computePoolId || TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
      statement: overrides.sqlStatement || "SELECT * FROM test_table",
      principal: "test-principal",
      authorized_principals: [],
      properties: {
        "sql.current-catalog": TEST_CCLOUD_ENVIRONMENT.name,
        "sql.current-database": TEST_CCLOUD_KAFKA_CLUSTER.name,
        "sql.local-time-zone": "GMT-04:00",
      },
      stopped: false,
    },
  });
}

export function makeStatus(phase: Phase): SqlV1StatementStatus {
  return createFlinkStatement({ phase }).status;
}
