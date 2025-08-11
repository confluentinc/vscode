import assert from "assert";
import * as sinon from "sinon";

import { loadFixtureFromFile } from "../../tests/fixtures/utils";
import { StubbedEventEmitters, eventEmitterStubs } from "../../tests/stubs/emitters";
import { getSidecarStub } from "../../tests/stubs/sidecar";
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
  FcpmV2RegionList,
  FcpmV2RegionListApiVersionEnum,
  FcpmV2RegionListDataInner,
  FcpmV2RegionListDataInnerApiVersionEnum,
  FcpmV2RegionListDataInnerKindEnum,
  FcpmV2RegionListKindEnum,
  RegionsFcpmV2Api,
} from "../clients/flinkComputePool";
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
import { CCLOUD_BASE_PATH, CCLOUD_CONNECTION_ID } from "../constants";
import * as graphqlCCloud from "../graphql/ccloud";
import * as graphqlOrgs from "../graphql/organizations";
import { restFlinkStatementToModel } from "../models/flinkStatement";
import * as sidecar from "../sidecar";
import { ResourceManager } from "../storage/resourceManager";
import { CachingResourceLoader } from "./cachingResourceLoader";
import { CCloudResourceLoader, loadProviderRegions } from "./ccloudResourceLoader";

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

  describe("constructor", () => {
    it("should register at least one event handler disposable after construction", () => {
      const eventHandlers = loader["disposables"];
      assert(eventHandlers.length > 0, "Expected at least one event handler to be registered");
    });
  });

  describe("setEventListeners", () => {
    let emitterStubs: StubbedEventEmitters;

    beforeEach(() => {
      // Stub all event emitters in the emitters module
      emitterStubs = eventEmitterStubs(sandbox);
    });

    // Expected pairs of emitter and handler method names
    const handlerEmitterPairs: Array<[keyof typeof emitterStubs, keyof CCloudResourceLoader]> = [
      ["ccloudConnected", "ccloudConnectedHandler"],
    ];

    it("setEventListeners() should return the expected number of listeners", () => {
      // @ts-expect-error protected method
      const listeners = loader.setEventListeners();
      assert.strictEqual(listeners.length, handlerEmitterPairs.length);
    });

    handlerEmitterPairs.forEach(([emitterName, handlerMethodName]) => {
      it(`should register ${handlerMethodName} with ${emitterName} emitter`, () => {
        // Create stub for the handler method
        const handlerStub = sandbox.stub(loader, handlerMethodName);

        // Re-invoke setEventListeners() to capture emitter .event() stub calls, protected method.
        loader["setEventListeners"]();

        const emitterStub = emitterStubs[emitterName]!;

        // Verify the emitter's event method was called
        sinon.assert.calledOnce(emitterStub.event);

        // Capture the handler function that was registered
        const registeredHandler = emitterStub.event.firstCall.args[0];

        // Call the registered handler
        registeredHandler();

        // Verify the expected method stub was called,
        // proving that the expected handler was registered
        // to the expected emitter.
        sinon.assert.calledOnce(handlerStub);
      });
    });
  });

  describe("ccloudConnectedHandler", () => {
    let resetStub: sinon.SinonStub;
    let ensureCoarseResourcesLoadedStub: sinon.SinonStub;
    beforeEach(() => {
      resetStub = sandbox.stub(loader, "reset").resolves();
      ensureCoarseResourcesLoadedStub = sandbox
        .stub(loader as any, "ensureCoarseResourcesLoaded")
        .resolves();
    });

    for (const connected of [true, false]) {
      it(`should reset the loader state when connected is ${connected}`, async () => {
        await loader.ccloudConnectedHandler(connected);
        sinon.assert.calledOnce(resetStub);
        if (!connected) {
          sinon.assert.notCalled(ensureCoarseResourcesLoadedStub);
        }
      });
    }

    it("should call ensureCoarseResourcesLoaded when connected is true", async () => {
      await loader.ccloudConnectedHandler(true);
      sinon.assert.calledOnce(ensureCoarseResourcesLoadedStub);
    });
  });

  describe("reset", () => {
    it("should reset the organization to null", async () => {
      loader["organization"] = TEST_CCLOUD_ORGANIZATION;
      await loader.reset();
      assert.strictEqual(loader["organization"], null);
    });

    it("should call super.reset()", async () => {
      const superResetStub = sandbox.stub(CachingResourceLoader.prototype, "reset").resolves();
      await loader.reset();
      sinon.assert.calledOnce(superResetStub);
    });
  });

  describe("getOrganization", () => {
    let getCurrentOrganizationStub: sinon.SinonStub;
    beforeEach(() => {
      getCurrentOrganizationStub = sandbox.stub(graphqlOrgs, "getCurrentOrganization");
    });

    it("should return the cached current organization", async () => {
      loader["organization"] = TEST_CCLOUD_ORGANIZATION;
      const org = await loader.getOrganization();
      assert.strictEqual(org, TEST_CCLOUD_ORGANIZATION);
      sinon.assert.notCalled(getCurrentOrganizationStub);
    });

    it("should fetch the current organization if not cached", async () => {
      getCurrentOrganizationStub.resolves(TEST_CCLOUD_ORGANIZATION);
      const org = await loader.getOrganization();
      assert.strictEqual(org, TEST_CCLOUD_ORGANIZATION);
      sinon.assert.calledOnce(getCurrentOrganizationStub);
    });

    it("should return undefined if no organization is available", async () => {
      getCurrentOrganizationStub.resolves(undefined);
      const org = await loader.getOrganization();
      assert.strictEqual(org, undefined);
      sinon.assert.calledOnce(getCurrentOrganizationStub);
    });
  });

  describe("determineFlinkQueryables", () => {
    let getOrganizationStub: sinon.SinonStub;
    beforeEach(() => {
      getOrganizationStub = sandbox
        .stub(loader, "getOrganization")
        .resolves(TEST_CCLOUD_ORGANIZATION);
    });

    it("should return empty array if no organization is available", async () => {
      getOrganizationStub.resolves(undefined);
      const queryables = await loader.determineFlinkQueryables(TEST_CCLOUD_ENVIRONMENT);
      assert.deepStrictEqual(queryables, []);
      sinon.assert.calledOnce(getOrganizationStub);
    });

    it("should return facts from provided compute pool", async () => {
      const queryables = await loader.determineFlinkQueryables(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(queryables.length, 1);
      assert.strictEqual(queryables[0].organizationId, TEST_CCLOUD_ORGANIZATION.id);
      assert.strictEqual(queryables[0].environmentId, TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId);
      assert.strictEqual(queryables[0].computePoolId, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
      assert.strictEqual(queryables[0].provider, TEST_CCLOUD_FLINK_COMPUTE_POOL.provider);
      assert.strictEqual(queryables[0].region, TEST_CCLOUD_FLINK_COMPUTE_POOL.region);
      sinon.assert.calledOnce(getOrganizationStub);
    });

    it("should reduce all of the compute pools in an environment to a reduced set of queryables", async () => {
      const computePool1 = {
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-1m68g66",
        provider: "aws",
        region: "us-west-2",
      };
      const computePool2 = {
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-2m68g66",
        provider: "aws",
        region: "us-east-1", // different region
      };
      const computePool3 = {
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-3m68g66",
        provider: "gcp", // different cloud provider from computePool1 and computePool2
        region: "us-west-2",
      };

      const computePool4 = {
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-4m68g66",
        provider: "aws",
        region: "us-west-2", // same as computePool1
      };

      const environmentWithPools = {
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [computePool1, computePool2, computePool3, computePool4],
      };

      const queryables = await loader.determineFlinkQueryables(environmentWithPools);
      // computePool4 is same provider/region as computePool1, so should not be included.
      assert.strictEqual(queryables.length, 3);

      // All should have same organizationId and environmentId
      queryables.forEach((q) => {
        assert.strictEqual(q.organizationId, TEST_CCLOUD_ORGANIZATION.id);
        assert.strictEqual(q.environmentId, environmentWithPools.id);
      });

      // set of `${queryable.provider}-${queryable.region}` should include
      // all unique provider-region combinations.
      const uniqueProviderRegions = new Set(queryables.map((q) => `${q.provider}-${q.region}`));
      assert.strictEqual(uniqueProviderRegions.size, 3);
      assert(uniqueProviderRegions.has("aws-us-west-2"));
      assert(uniqueProviderRegions.has("aws-us-east-1"));
      assert(uniqueProviderRegions.has("gcp-us-west-2"));

      // Should NOT have computePoolId specified, since any query using
      // any of these should not be limited to a specific compute pool.
      queryables.forEach((q) => {
        assert.strictEqual(q.computePoolId, undefined);
      });
    });
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
            self: `https://api.${CCLOUD_BASE_PATH}/v1/sql/statements`,
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
          self: `https://api.${CCLOUD_BASE_PATH}/v1/sql/statements`,
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
      assert.ok(args, "Expected args to be defined");
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

  describe("loadProviderRegions", () => {
    let regionsApiStub: sinon.SinonStubbedInstance<RegionsFcpmV2Api>;

    beforeEach(() => {
      let stubbedSidecar = getSidecarStub(sandbox);
      regionsApiStub = sandbox.createStubInstance(RegionsFcpmV2Api);
      stubbedSidecar.getRegionsFcpmV2Api.returns(regionsApiStub);
    });

    it("should handle zero regions to list", async () => {
      const mockResponse = makeFakeListRegionsResponse(false, 0);

      regionsApiStub.listFcpmV2Regions.resolves(mockResponse);

      const regions = await loadProviderRegions();
      assert.strictEqual(regions.length, 0);
      sinon.assert.calledOnce(regionsApiStub.listFcpmV2Regions);

      const args = regionsApiStub.listFcpmV2Regions.getCall(0).args[0];
      assert.strictEqual(args?.page_size, 100);
      assert.strictEqual(args?.page_token, undefined);
    });

    it("should handle one page of regions", async () => {
      // Simulate one page of regions.
      const mockResponse = makeFakeListRegionsResponse(false, 3);

      regionsApiStub.listFcpmV2Regions.resolves(mockResponse);
      const regions = await loadProviderRegions();
      assert.strictEqual(regions.length, 3);
      sinon.assert.calledOnce(regionsApiStub.listFcpmV2Regions);
    });

    it("should handle multiple pages of regions", async () => {
      const mockResponse = makeFakeListRegionsResponse(true, 3);
      const mockResponse2 = makeFakeListRegionsResponse(false, 2);
      regionsApiStub.listFcpmV2Regions
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves(mockResponse2);
      const regions = await loadProviderRegions();
      assert.strictEqual(regions.length, 5);
      sinon.assert.calledTwice(regionsApiStub.listFcpmV2Regions);
    });

    it("should handle errors during region loading", async () => {
      const error = new Error("API request failed");
      regionsApiStub.listFcpmV2Regions.rejects(error);

      await assert.rejects(async () => {
        await loadProviderRegions();
      }, error);
    });

    it("should handle pagination correctly", async () => {
      const mockResponse1 = makeFakeListRegionsResponse(true, 2);
      const mockResponse2 = makeFakeListRegionsResponse(false, 1);

      regionsApiStub.listFcpmV2Regions
        .onFirstCall()
        .resolves(mockResponse1)
        .onSecondCall()
        .resolves(mockResponse2);

      const regions = await loadProviderRegions();

      assert.strictEqual(regions.length, 3);
      sinon.assert.calledTwice(regionsApiStub.listFcpmV2Regions);

      const secondCallArgs = regionsApiStub.listFcpmV2Regions.getCall(1).args[0];
      assert.strictEqual(secondCallArgs?.page_token, "test-page-token");
    });

    function makeFakeListRegionsResponse(
      hasNextPage: boolean,
      regionCount: number,
    ): FcpmV2RegionList {
      const regions: FcpmV2RegionListDataInner[] = [];

      for (let i = 0; i < regionCount; i++) {
        regions.push({
          api_version: FcpmV2RegionListDataInnerApiVersionEnum.FcpmV2,
          kind: FcpmV2RegionListDataInnerKindEnum.Region,
          id: `region-${i}`,
          metadata: {
            self: `https://api.confluent.cloud/fcpm/v2/regions/region-${i}`,
          },
          display_name: `Region ${i}`,
          cloud: i % 2 === 0 ? "AWS" : "AZURE",
          region_name: `region-${i}`,
          http_endpoint: `https://flink.region-${i}.confluent.cloud`,
        });
      }

      const maybeNextPageLink: string = hasNextPage
        ? "https://api.confluent.cloud/fcpm/v2/regions?page_token=test-page-token"
        : "";

      return {
        api_version: FcpmV2RegionListApiVersionEnum.FcpmV2,
        kind: FcpmV2RegionListKindEnum.RegionList,
        metadata: {
          next: maybeNextPageLink,
        },
        data: new Set(regions),
      };
    }
  });
});
