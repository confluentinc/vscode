import assert from "assert";
import * as sinon from "sinon";

import { loadFixtureFromFile } from "../../tests/fixtures/utils";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { createResponseError } from "../../tests/unit/testUtils";
import {
  ArtifactV1FlinkArtifactList,
  ArtifactV1FlinkArtifactListApiVersionEnum,
  ArtifactV1FlinkArtifactListDataInner,
  ArtifactV1FlinkArtifactListDataInnerApiVersionEnum,
  ArtifactV1FlinkArtifactListDataInnerKindEnum,
  ArtifactV1FlinkArtifactListKindEnum,
  FlinkArtifactsArtifactV1Api,
} from "../clients/flinkArtifacts";
import {
  GetSqlv1Statement200Response,
  SqlV1StatementList,
  SqlV1StatementListApiVersionEnum,
  SqlV1StatementListDataInner,
  SqlV1StatementListDataInnerApiVersionEnum,
  SqlV1StatementListDataInnerKindEnum,
  SqlV1StatementListKindEnum,
  StatementsSqlV1Api,
} from "../clients/flinkSql";
import { CCLOUD_CONNECTION_ID } from "../constants";
import * as graphqlCCloud from "../graphql/ccloud";
import * as graphqlOrgs from "../graphql/organizations";
import { restFlinkStatementToModel } from "../models/flinkStatement";
import * as sidecar from "../sidecar";
import { ResourceManager } from "../storage/resourceManager";
import { CCloudResourceLoader } from "./ccloudResourceLoader";

describe("CCloudResourceLoader", () => {
  let sandbox: sinon.SinonSandbox;
  let loader: CCloudResourceLoader;

  let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loader = CCloudResourceLoader.getInstance();

    stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubbedResourceManager);
  });

  afterEach(() => {
    loader.dispose();
    CCloudResourceLoader["instance"] = null; // Reset singleton instance
    sandbox.restore();
  });

  describe("getFlinkStatements", () => {
    let flinkStatementsApiStub: sinon.SinonStubbedInstance<StatementsSqlV1Api>;

    beforeEach(() => {
      // stub the sidecar getFlinkSqlStatementsApi API
      const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
        sandbox.createStubInstance(sidecar.SidecarHandle);
      flinkStatementsApiStub = sandbox.createStubInstance(StatementsSqlV1Api);
      mockSidecarHandle.getFlinkSqlStatementsApi.returns(flinkStatementsApiStub);
      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

      sandbox.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);
    });

    it("Handles zero statements to list", async () => {
      // Simulate zero available statements.
      const mockResponse = makeFakeListStatementsResponse(false, 0);

      flinkStatementsApiStub.listSqlv1Statements.resolves(mockResponse);

      const statements = await loader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(statements.length, 0);
      sinon.assert.calledOnce(flinkStatementsApiStub.listSqlv1Statements);

      // Test the args passed to the API.
      const args = flinkStatementsApiStub.listSqlv1Statements.getCall(0).args[0];
      assert.strictEqual(args.organization_id, TEST_CCLOUD_ORGANIZATION.id);
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
      const statements = await loader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
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
      const statements = await loader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
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

  describe("refreshFlinkStatement()", () => {
    let flinkSqlStatementsApi: sinon.SinonStubbedInstance<StatementsSqlV1Api>;

    beforeEach(() => {
      // stub the sidecar getFlinkSqlStatementsApi API
      const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
        sandbox.createStubInstance(sidecar.SidecarHandle);
      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

      flinkSqlStatementsApi = sandbox.createStubInstance(StatementsSqlV1Api);
      mockSidecarHandle.getFlinkSqlStatementsApi.returns(flinkSqlStatementsApi);
    });

    it("should return the statement if found", async () => {
      const responseString = loadFixtureFromFile(
        "flink-statement-results-processing/create-statement-response.json",
      );
      const mockResponse = JSON.parse(responseString) as GetSqlv1Statement200Response;

      flinkSqlStatementsApi.getSqlv1Statement.resolves(mockResponse);

      const expectedStatement = restFlinkStatementToModel(mockResponse, {
        provider: "aws",
        region: "us-west-2",
      });

      const updatedStatement = await loader.refreshFlinkStatement(expectedStatement);
      assert.deepStrictEqual(updatedStatement, expectedStatement);
    });

    it("should return null if statement is not found", async () => {
      // Simulate a 404 error from the API
      flinkSqlStatementsApi.getSqlv1Statement.rejects(
        createResponseError(404, "Not Found", "test"),
      );

      const shouldBeNull = await loader.refreshFlinkStatement(createFlinkStatement());
      assert.strictEqual(shouldBeNull, null);
    });

    it("Should raise if non-404 error occurs", async () => {
      // Simulate a 500 error from the API
      const error = createResponseError(500, "Internal Server Error", "test");
      flinkSqlStatementsApi.getSqlv1Statement.rejects(error);
      const statement = createFlinkStatement();
      await assert.rejects(async () => {
        await loader.refreshFlinkStatement(statement);
      });
    });
  }); // refreshFlinkStatement

  describe("getKafkaClustersForEnvironmentId", () => {
    beforeEach(() => {
      // Make ensureCoarseResourcesLoaded seem completed already
      // (private method)
      sandbox.stub(loader as any, "ensureCoarseResourcesLoaded").resolves();
    });

    it("should downcall to resource manager", async () => {
      stubbedResourceManager.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

      const clusters = await loader.getKafkaClustersForEnvironmentId(TEST_CCLOUD_ENVIRONMENT.id);
      assert.deepStrictEqual(clusters, [TEST_CCLOUD_KAFKA_CLUSTER]);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getKafkaClustersForEnvironmentId,
        CCLOUD_CONNECTION_ID,
        TEST_CCLOUD_ENVIRONMENT.id,
      );
    });

    it("should raise if no environmentId is provided", async () => {
      await assert.rejects(
        async () => {
          await loader.getKafkaClustersForEnvironmentId(undefined as any);
        },
        {
          name: "Error",
          message: "Cannot fetch clusters w/o an environmentId.",
        },
      );
    });
  });

  describe("doLoadCoarseResources", () => {
    let getEnvironmentsStub: sinon.SinonStub;
    let getCurrentOrganizationStub: sinon.SinonStub;

    beforeEach(() => {
      getEnvironmentsStub = sandbox.stub(graphqlCCloud, "getCCloudResources");
      getCurrentOrganizationStub = sandbox.stub(graphqlOrgs, "getCurrentOrganization");
    });

    it("should not throw any errors when no CCloud org is available", async () => {
      getEnvironmentsStub.resolves([]);
      getCurrentOrganizationStub.resolves(undefined);

      await loader["doLoadCoarseResources"]();

      sinon.assert.calledOnce(getEnvironmentsStub);
      sinon.assert.calledOnce(getCurrentOrganizationStub);
      assert.strictEqual(loader["organization"], null);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setEnvironments,
        CCLOUD_CONNECTION_ID,
        [],
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setKafkaClusters,
        CCLOUD_CONNECTION_ID,
        [],
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setSchemaRegistries,
        CCLOUD_CONNECTION_ID,
        [],
      );
    });

    it("should set CCloud resources when available", async () => {
      getEnvironmentsStub.resolves([TEST_CCLOUD_ENVIRONMENT]);
      getCurrentOrganizationStub.resolves(TEST_CCLOUD_ORGANIZATION);

      await loader["doLoadCoarseResources"]();

      sinon.assert.calledOnce(getEnvironmentsStub);
      sinon.assert.calledOnce(getCurrentOrganizationStub);
      assert.strictEqual(loader["organization"], TEST_CCLOUD_ORGANIZATION);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setEnvironments,
        CCLOUD_CONNECTION_ID,
        [TEST_CCLOUD_ENVIRONMENT],
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setKafkaClusters,
        CCLOUD_CONNECTION_ID,
        TEST_CCLOUD_ENVIRONMENT.kafkaClusters, // empty array by default
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setSchemaRegistries,
        CCLOUD_CONNECTION_ID,
        TEST_CCLOUD_ENVIRONMENT.schemaRegistry ? [TEST_CCLOUD_ENVIRONMENT.schemaRegistry] : [],
      );
    });
  });

  describe("getFlinkArtifacts", () => {
    let flinkArtifactsApiStub: sinon.SinonStubbedInstance<FlinkArtifactsArtifactV1Api>;

    beforeEach(() => {
      // stub the sidecar getFlinkArtifactsApi API
      const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
        sandbox.createStubInstance(sidecar.SidecarHandle);
      flinkArtifactsApiStub = sandbox.createStubInstance(FlinkArtifactsArtifactV1Api);
      mockSidecarHandle.getFlinkArtifactsApi.returns(flinkArtifactsApiStub);
      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

      sandbox.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);
    });

    it("should handle zero artifacts to list", async () => {
      // Simulate zero available artifacts.
      const mockResponse = makeFakeListArtifactsResponse(false, 0);

      flinkArtifactsApiStub.listArtifactV1FlinkArtifacts.resolves(mockResponse);

      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(artifacts.length, 0);
      sinon.assert.calledOnce(flinkArtifactsApiStub.listArtifactV1FlinkArtifacts);

      // Test the args passed to the API.
      const args = flinkArtifactsApiStub.listArtifactV1FlinkArtifacts.getCall(0).args[0];
      assert.strictEqual(args.cloud, TEST_CCLOUD_FLINK_COMPUTE_POOL.provider);
      assert.strictEqual(args.region, TEST_CCLOUD_FLINK_COMPUTE_POOL.region);
      assert.strictEqual(args.environment, TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId);
      assert.strictEqual(args.page_size, 100);
      assert.strictEqual(args.page_token, "");
    });

    it("should handle one page of artifacts", async () => {
      // Simulate one page of artifacts.
      const mockResponse = makeFakeListArtifactsResponse(false, 3);

      flinkArtifactsApiStub.listArtifactV1FlinkArtifacts.resolves(mockResponse);
      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(artifacts.length, 3);
      sinon.assert.calledOnce(flinkArtifactsApiStub.listArtifactV1FlinkArtifacts);
    });

    it("should handle multiple pages of artifacts", async () => {
      // Simulate multiple pages of artifacts.
      const mockResponse = makeFakeListArtifactsResponse(true, 3);
      const mockResponse2 = makeFakeListArtifactsResponse(false, 2);
      flinkArtifactsApiStub.listArtifactV1FlinkArtifacts
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves(mockResponse2);
      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(artifacts.length, 5);
      sinon.assert.calledTwice(flinkArtifactsApiStub.listArtifactV1FlinkArtifacts);
    });

    /** Make a fake list flink artifacts API response with requested artifact count and indicating next page available. */
    function makeFakeListArtifactsResponse(
      hasNextPage: boolean,
      artifactCount: number,
    ): ArtifactV1FlinkArtifactList {
      const artifacts: ArtifactV1FlinkArtifactListDataInner[] = [];

      for (let i = 0; i < artifactCount; i++) {
        artifacts.push({
          api_version: ArtifactV1FlinkArtifactListDataInnerApiVersionEnum.ArtifactV1,
          kind: ArtifactV1FlinkArtifactListDataInnerKindEnum.FlinkArtifact,
          id: `artifact-${i}`,
          metadata: {
            created_at: new Date(),
            updated_at: new Date(),
            self: undefined, // self link is not used in tests
          },
          cloud: "aws",
          region: "us-east-1",
          environment: "env-12345",
          display_name: `Test Artifact ${i}`,
          description: `Test artifact description ${i}`,
          content_format: "JAR",
          runtime_language: "JAVA",
        });
      }

      const maybeNextPageLink: string = hasNextPage ? "https://foo.com/?page_token=foonly" : "";
      return {
        api_version: ArtifactV1FlinkArtifactListApiVersionEnum.ArtifactV1,
        kind: ArtifactV1FlinkArtifactListKindEnum.FlinkArtifactList,
        metadata: {
          next: maybeNextPageLink,
        },
        data: new Set(artifacts),
      };
    }
  }); // getFlinkArtifacts
});
