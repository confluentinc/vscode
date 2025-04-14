import assert from "assert";
import * as sinon from "sinon";

import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import {
  SqlV1StatementList,
  SqlV1StatementListApiVersionEnum,
  SqlV1StatementListDataInner,
  SqlV1StatementListDataInnerApiVersionEnum,
  SqlV1StatementListDataInnerKindEnum,
  SqlV1StatementListKindEnum,
  StatementsSqlV1Api,
} from "../clients/flinkSql";
import * as sidecar from "../sidecar";
import { CCloudResourceLoader } from "./ccloudResourceLoader";

describe("CCloudResourceLoader", () => {
  describe("getFlinkStatements", () => {
    let resourceLoader: CCloudResourceLoader;

    let sandbox: sinon.SinonSandbox;
    let flinkStatementsApiStub: sinon.SinonStubbedInstance<StatementsSqlV1Api>;

    const testOrgId = "01234";
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      resourceLoader = CCloudResourceLoader.getInstance();

      // stub the sidecar getFlinkSqlStatementsApi API
      const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
        sandbox.createStubInstance(sidecar.SidecarHandle);
      flinkStatementsApiStub = sandbox.createStubInstance(StatementsSqlV1Api);
      mockSidecarHandle.getFlinkSqlStatementsApi.returns(flinkStatementsApiStub);
      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

      sandbox.stub(resourceLoader, "getOrganizationId").resolves(testOrgId);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it("Handles zero statements to list", async () => {
      // Simulate zero available statements.
      const mockResponse = makeFakeListStatementsResponse(false, 0);

      flinkStatementsApiStub.listSqlv1Statements.resolves(mockResponse);

      const statements = await resourceLoader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(statements.length, 0);
      sinon.assert.calledOnce(flinkStatementsApiStub.listSqlv1Statements);

      // Test the args passed to the API.
      const args = flinkStatementsApiStub.listSqlv1Statements.getCall(0).args[0];
      assert.strictEqual(args.organization_id, testOrgId);
      assert.strictEqual(args.environment_id, TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId);
      assert.strictEqual(args.page_size, 100);
      assert.strictEqual(args.page_token, "");
      // Should be excluding hidden statements.
      assert.strictEqual(args.label_selector, "user.confluent.io/hidden!=true");
    });

    it("Handles one page of statements", async () => {
      // Simulate one page of statements.
      const mockResponse = makeFakeListStatementsResponse(false, 3);

      flinkStatementsApiStub.listSqlv1Statements.resolves(mockResponse);
      const statements = await resourceLoader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(statements.length, 3);
      sinon.assert.calledOnce(flinkStatementsApiStub.listSqlv1Statements);
    });

    it("Handles multiple pages of statements", async () => {
      // Simulate multiple pages of statements.
      const mockResponse = makeFakeListStatementsResponse(true, 3);
      const mockResponse2 = makeFakeListStatementsResponse(false, 2);
      flinkStatementsApiStub.listSqlv1Statements
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves(mockResponse2);
      const statements = await resourceLoader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(statements.length, 5);
      sinon.assert.calledTwice(flinkStatementsApiStub.listSqlv1Statements);
    });

    /** Make a fake list flink statements API response with requested statement count and indicating next page available. */
    function makeFakeListStatementsResponse(
      hasNextPage: boolean,
      statementCount: number,
    ): SqlV1StatementList {
      const statements: SqlV1StatementListDataInner[] = [];

      for (let i = 0; i < statementCount; i++) {
        statements.push({
          api_version: SqlV1StatementListDataInnerApiVersionEnum.SqlV1,
          kind: SqlV1StatementListDataInnerKindEnum.Statement,
          metadata: {
            self: "https://api.confluent.cloud/v1/sql/statements",
            created_at: new Date(),
            updated_at: new Date(),
            uid: "12345",
            resource_version: "67890",
            labels: {},
          },
          name: `statement-${i}`,
          organization_id: "01234",
          environment_id: "56789",
          spec: {
            authorized_principals: [],
            // Only some statements will have compute pool designation.
            compute_pool_id: i % 2 === 0 ? "lfcp-1m68g66" : undefined,
            principal: "u-n9dfg06",
            properties: {
              "sql.current-catalog": "custom-data-env",
              "sql.current-database": "Custom Data Dedicated Replica",
              "sql.local-time-zone": "GMT-04:00",
            },
            statement:
              "select when_reported, tempf, solarradiation from WeatherData\nwhere solarradiation > 600\n  order by tempf desc\nlimit 20",
            stopped: false,
          },
          status: {
            phase: "STOPPED",
            scaling_status: {
              scaling_state: "OK",
              last_updated: new Date("2025-04-10T20:28:45.000Z"),
            },
            detail:
              "This statement was automatically stopped since no client has consumed the results for 5 minutes or more.",
            traits: {
              sql_kind: "SELECT",
              is_bounded: false,
              is_append_only: true,
              schema: {
                columns: [
                  {
                    name: "when_reported",
                    type: {
                      type: "TIMESTAMP_WITH_LOCAL_TIME_ZONE",
                      nullable: false,
                      precision: 6,
                    },
                  },
                  {
                    name: "solarradiation",
                    type: {
                      type: "DOUBLE",
                      nullable: false,
                    },
                  },
                ],
              },
            },
            latest_offsets: {
              high_sun_2023:
                "partition:0,offset:-2;partition:1,offset:-2;partition:2,offset:-2;partition:3,offset:-2;partition:4,offset:-2;partition:5,offset:-2",
            },
            latest_offsets_timestamp: new Date("2025-04-10T20:39:29.000Z"),
          },
        });
      }

      const maybeNextPageLink: string = hasNextPage ? "https://foo.com/?page_token=foonly" : "";
      return {
        api_version: SqlV1StatementListApiVersionEnum.SqlV1,
        kind: SqlV1StatementListKindEnum.StatementList,
        metadata: {
          self: "https://api.confluent.cloud/v1/sql/statements",
          next: maybeNextPageLink,
        },
        data: new Set(statements),
      };
    }
  }); // getFlinkStatements
}); // CCloudResourceLoader
