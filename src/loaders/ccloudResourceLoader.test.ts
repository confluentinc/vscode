import assert from "assert";
import * as sinon from "sinon";

import { loadFixtureFromFile } from "../../tests/fixtures/utils";
import { StubbedEventEmitters, eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedResourceManager } from "../../tests/stubs/extensionStorage";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { makeUdfFunctionRow } from "../../tests/unit/testResources/ccloudResourceLoader";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { createFlinkUDF } from "../../tests/unit/testResources/flinkUDF";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { createResponseError, getTestExtensionContext } from "../../tests/unit/testUtils";
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
import * as statementUtils from "../flinkSql/statementUtils";
import * as graphqlCCloud from "../graphql/ccloud";
import * as graphqlOrgs from "../graphql/organizations";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, Phase, restFlinkStatementToModel } from "../models/flinkStatement";
import { FlinkUdf } from "../models/flinkUDF";
import { CCloudFlinkDbKafkaCluster, CCloudKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import * as sidecar from "../sidecar";
import { SidecarHandle } from "../sidecar";
import { ResourceManager } from "../storage/resourceManager";
import { CachingResourceLoader } from "./cachingResourceLoader";
import {
  CCloudResourceLoader,
  loadArtifactsForProviderRegion,
  loadProviderRegions,
} from "./ccloudResourceLoader";
import { RawUdfSystemCatalogRow } from "./ccloudResourceLoaderUtils";

describe("CCloudResourceLoader", () => {
  let sandbox: sinon.SinonSandbox;
  let loader: CCloudResourceLoader;

  let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stubbedResourceManager = getStubbedResourceManager(sandbox);

    loader = CCloudResourceLoader.getInstance();
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
        registeredHandler(undefined); // pass some dummy arg

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

    it("should return facts from provided ccloud kafka cluster", async () => {
      const queryables = await loader.determineFlinkQueryables(TEST_CCLOUD_KAFKA_CLUSTER);
      assert.strictEqual(queryables.length, 1);
      assert.strictEqual(queryables[0].organizationId, TEST_CCLOUD_ORGANIZATION.id);
      assert.strictEqual(queryables[0].environmentId, TEST_CCLOUD_KAFKA_CLUSTER.environmentId);
      assert.strictEqual(queryables[0].computePoolId, undefined);
      assert.strictEqual(queryables[0].provider, TEST_CCLOUD_KAFKA_CLUSTER.provider);
      assert.strictEqual(queryables[0].region, TEST_CCLOUD_KAFKA_CLUSTER.region);
      sinon.assert.calledOnce(getOrganizationStub);
    });

    it("should reduce all of the compute pools in an environment to a reduced set of queryables", async () => {
      const computePool1: CCloudFlinkComputePool = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-1m68g66",
        provider: "aws",
        region: "us-west-2",
      });
      const computePool2: CCloudFlinkComputePool = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-2m68g66",
        provider: "aws",
        region: "us-east-1", // different region
      });
      const computePool3: CCloudFlinkComputePool = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-3m68g66",
        provider: "gcp", // different cloud provider from computePool1 and computePool2
        region: "us-west-2",
      });

      // Same provider/region as computePool1, should be reduced away.
      const computePool4: CCloudFlinkComputePool = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        id: "lfcp-4m68g66",
        provider: "aws", // same as computePool1
        region: "us-west-2", // same as computePool1
      });

      const environmentWithPools: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [computePool1, computePool2, computePool3, computePool4],
      });

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

  describe("getFlinkComputePools", () => {
    let getEnvironmentsStub: sinon.SinonStub;

    const envId1 = "env-target" as EnvironmentId;
    const envId2 = "env-other" as EnvironmentId;
    const computePool1 = new CCloudFlinkComputePool({
      ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
      id: "lfcp-1",
      name: "Pool 1",
      environmentId: envId1,
    });
    const computePool2 = new CCloudFlinkComputePool({
      ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
      id: "lfcp-2",
      name: "Pool 2",
      environmentId: envId1,
    });
    const computePool3 = new CCloudFlinkComputePool({
      ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
      id: "lfcp-3",
      name: "Pool 3",
      environmentId: envId2,
    });
    const env1 = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      id: envId1,
      flinkComputePools: [computePool1, computePool2],
    });
    const env2 = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      id: envId2,
      flinkComputePools: [computePool3],
    });

    beforeEach(() => {
      getEnvironmentsStub = sandbox.stub(loader, "getEnvironments");
    });

    it("should return all Flink compute pools from all environments when no environmentId is provided", async () => {
      getEnvironmentsStub.resolves([env1, env2]);

      const pools: CCloudFlinkComputePool[] = await loader.getFlinkComputePools();

      assert.strictEqual(pools.length, 3);
      assert.ok(pools.includes(computePool1));
      assert.ok(pools.includes(computePool2));
      assert.ok(pools.includes(computePool3));
      sinon.assert.calledOnce(getEnvironmentsStub);
    });

    it("should return only Flink compute pools from the specified environment", async () => {
      getEnvironmentsStub.resolves([env1, env2]);

      const pools: CCloudFlinkComputePool[] = await loader.getFlinkComputePools(envId1);

      assert.strictEqual(pools.length, 2);
      assert.ok(pools.includes(computePool1));
      assert.ok(pools.includes(computePool2));
      // shouldn't include pools from a different environment
      assert.ok(!pools.includes(computePool3));
      sinon.assert.calledOnce(getEnvironmentsStub);
    });

    it("should return an empty array when no environments exist", async () => {
      getEnvironmentsStub.resolves([]);

      const pools = await loader.getFlinkComputePools();
      assert.strictEqual(pools.length, 0);
      sinon.assert.calledOnce(getEnvironmentsStub);
    });

    it("should return an empty array when no available environments have Flink compute pools", async () => {
      const envWithoutPools = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });
      getEnvironmentsStub.resolves([envWithoutPools]);

      const pools: CCloudFlinkComputePool[] = await loader.getFlinkComputePools();

      assert.strictEqual(pools.length, 0);
      sinon.assert.calledOnce(getEnvironmentsStub);
    });

    it("should return an empty array when filtering by non-existent environment", async () => {
      getEnvironmentsStub.resolves([env1, env2]);

      const pools: CCloudFlinkComputePool[] = await loader.getFlinkComputePools(
        "some-other-env" as EnvironmentId,
      );

      assert.strictEqual(pools.length, 0);
      sinon.assert.calledOnce(getEnvironmentsStub);
    });
  });

  describe("getFlinkComputePool", () => {
    let getFlinkComputePoolsStub: sinon.SinonStub;

    const pool1 = new CCloudFlinkComputePool({
      ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
      id: "lfcp-1",
      name: "Pool 1",
    });
    const pool2 = new CCloudFlinkComputePool({
      ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
      id: "lfcp-2",
      name: "Pool 2",
    });

    beforeEach(() => {
      getFlinkComputePoolsStub = sandbox.stub(loader, "getFlinkComputePools");
    });

    it("should return the Flink compute pool matching the provided ID", async () => {
      getFlinkComputePoolsStub.resolves([pool1, pool2]);

      const pool: CCloudFlinkComputePool | undefined = await loader.getFlinkComputePool(pool2.id);

      assert.strictEqual(pool, pool2);
      sinon.assert.calledOnce(getFlinkComputePoolsStub);
    });

    it("should return undefined when no compute pool matches the provided ID", async () => {
      getFlinkComputePoolsStub.resolves([pool1, pool2]);

      const pool: CCloudFlinkComputePool | undefined =
        await loader.getFlinkComputePool("lfcp-nonexistent");
      assert.strictEqual(pool, undefined);
      sinon.assert.calledOnce(getFlinkComputePoolsStub);
    });

    it("should return undefined when no compute pools exist", async () => {
      getFlinkComputePoolsStub.resolves([]);

      const pool: CCloudFlinkComputePool | undefined = await loader.getFlinkComputePool("lfcp-any");

      assert.strictEqual(pool, undefined);
      sinon.assert.calledOnce(getFlinkComputePoolsStub);
    });
  });

  describe("getFlinkStatements", () => {
    let flinkStatementsApiStub: sinon.SinonStubbedInstance<StatementsSqlV1Api>;

    beforeEach(() => {
      // stub the sidecar getFlinkSqlStatementsApi API
      const stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle> = getSidecarStub(sandbox);
      flinkStatementsApiStub = sandbox.createStubInstance(StatementsSqlV1Api);
      stubbedSidecar.getFlinkSqlStatementsApi.returns(flinkStatementsApiStub);

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
  });

  describe("refreshFlinkStatement()", () => {
    let flinkSqlStatementsApi: sinon.SinonStubbedInstance<StatementsSqlV1Api>;

    beforeEach(() => {
      // stub the sidecar getFlinkSqlStatementsApi API
      const stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle> = getSidecarStub(sandbox);
      flinkSqlStatementsApi = sandbox.createStubInstance(StatementsSqlV1Api);
      stubbedSidecar.getFlinkSqlStatementsApi.returns(flinkSqlStatementsApi);
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
  });

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

    it("does nothing when no CCloud org is available", async () => {
      getEnvironmentsStub.resolves([]);
      getCurrentOrganizationStub.resolves(undefined);

      await loader["doLoadCoarseResources"]();
      sinon.assert.calledOnce(getEnvironmentsStub);
      sinon.assert.calledOnce(getCurrentOrganizationStub);
      assert.strictEqual(loader["organization"], null);
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

  describe("loadArtifactsForProviderRegion", () => {
    let stubbedFlinkArtifactsApi: sinon.SinonStubbedInstance<FlinkArtifactsArtifactV1Api>;
    let stubbedSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;
    beforeEach(() => {
      stubbedFlinkArtifactsApi = sandbox.createStubInstance(FlinkArtifactsArtifactV1Api);
      stubbedSidecarHandle = getSidecarStub(sandbox);

      stubbedSidecarHandle.getFlinkArtifactsApi.returns(stubbedFlinkArtifactsApi);

      sandbox.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);
    });
    it("should return empty array if response from 'loadArtifactsForProviderRegion' returns null data", async () => {
      const mockResponse = {
        api_version: ArtifactV1FlinkArtifactListApiVersionEnum.ArtifactV1,
        kind: ArtifactV1FlinkArtifactListKindEnum.FlinkArtifactList,
        metadata: {
          next: "",
        },
        data: null,
      } satisfies ArtifactV1FlinkArtifactList;

      stubbedFlinkArtifactsApi.listArtifactV1FlinkArtifacts.resolves(mockResponse);

      const artifacts = await loadArtifactsForProviderRegion(stubbedSidecarHandle, {
        provider: "aws",
        region: "us-west-2",
        organizationId: TEST_CCLOUD_ORGANIZATION.id,
        environmentId: "env-12345" as EnvironmentId,
      });
      assert.ok(Array.isArray(artifacts));
      assert.strictEqual(artifacts.length, 0);
      sinon.assert.calledOnce(stubbedFlinkArtifactsApi.listArtifactV1FlinkArtifacts);
    });
  });

  describe("getFlinkUDFs", () => {
    let executeFlinkStatementStub: sinon.SinonStub;

    beforeEach(() => {
      executeFlinkStatementStub = sandbox.stub(loader, "executeFlinkStatement");
      // By default, cache misses for UDFs.
      stubbedResourceManager.getFlinkUDFs.resolves(undefined);
    });

    it("should handle no UDFs returned from the statement", async () => {
      const emptyUDFs: FlinkUdf[] = [];
      executeFlinkStatementStub.resolves(emptyUDFs);

      const udfs = await loader.getFlinkUDFs(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);
      assert.ok(Array.isArray(udfs));
      assert.strictEqual(udfs.length, 0);
      sinon.assert.calledOnce(executeFlinkStatementStub);
      // Should have tried to get from cache first.
      sinon.assert.calledOnce(stubbedResourceManager.getFlinkUDFs);
      // Should have cached the empty result.
      sinon.assert.calledOnce(stubbedResourceManager.setFlinkUDFs);
      sinon.assert.calledWithExactly(
        stubbedResourceManager.setFlinkUDFs,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        emptyUDFs,
      );
    });

    it("should handle some UDFs returned from the statement", async () => {
      const udfResultRows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A"),
        makeUdfFunctionRow("B"),
        makeUdfFunctionRow("C"),
      ];

      executeFlinkStatementStub.resolves(udfResultRows);

      const udfs = await loader.getFlinkUDFs(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);
      assert.ok(Array.isArray(udfs));
      assert.strictEqual(udfs.length, udfResultRows.length);
      for (let i = 0; i < udfResultRows.length; i++) {
        assert.strictEqual(udfs[i].name, udfResultRows[i].functionRoutineName);
        assert.strictEqual(udfs[i].databaseId, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id);
      }
      sinon.assert.calledOnce(executeFlinkStatementStub);
      // Should have tried to get from cache first.
      sinon.assert.calledOnce(stubbedResourceManager.getFlinkUDFs);
      // Should have cached the result.
      sinon.assert.calledOnce(stubbedResourceManager.setFlinkUDFs);
      sinon.assert.calledWithExactly(
        stubbedResourceManager.setFlinkUDFs,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        udfs,
      );
    });

    it("should handle resourcemanager cache hit, then skipping the statement execution", async () => {
      const cachedUDFs: FlinkUdf[] = [createFlinkUDF("func1"), createFlinkUDF("func2")];
      stubbedResourceManager.getFlinkUDFs.resolves(cachedUDFs);

      const udfs = await loader.getFlinkUDFs(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);
      assert.deepStrictEqual(udfs, cachedUDFs);
      sinon.assert.calledOnce(stubbedResourceManager.getFlinkUDFs);
      sinon.assert.notCalled(executeFlinkStatementStub);
      sinon.assert.notCalled(stubbedResourceManager.setFlinkUDFs);
    });

    it("should honor forceDeepRefresh=true to skip cache and reload", async () => {
      const cachedUDFs: FlinkUdf[] = [
        createFlinkUDF("A"),
        createFlinkUDF("B"),
        createFlinkUDF("C"),
      ];
      stubbedResourceManager.getFlinkUDFs.resolves(cachedUDFs); // would be a cache hit, but...

      const udfResultRows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A"),
        makeUdfFunctionRow("B"),
        makeUdfFunctionRow("C"),
      ];
      executeFlinkStatementStub.resolves(udfResultRows);

      // call with forceDeepRefresh=true
      const udfs = await loader.getFlinkUDFs(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);
      assert.ok(Array.isArray(udfs));
      assert.strictEqual(udfs.length, udfResultRows.length);
      for (let i = 0; i < udfResultRows.length; i++) {
        assert.strictEqual(udfs[i].name, udfResultRows[i].functionRoutineName);
        assert.strictEqual(udfs[i].databaseId, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id);
      }

      // Will have consulted the cache, but then ignored it, and called the statement, then cached the results.
      sinon.assert.calledOnce(stubbedResourceManager.getFlinkUDFs);
      sinon.assert.calledOnce(executeFlinkStatementStub);
      sinon.assert.calledOnce(stubbedResourceManager.setFlinkUDFs);
      sinon.assert.calledWithExactly(
        stubbedResourceManager.setFlinkUDFs,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        udfs,
      );
    });
  });

  describe("getFlinkArtifacts", () => {
    let flinkArtifactsApiStub: sinon.SinonStubbedInstance<FlinkArtifactsArtifactV1Api>;

    beforeEach(() => {
      const mockSidecarHandle = getSidecarStub(sandbox);
      flinkArtifactsApiStub = sandbox.createStubInstance(FlinkArtifactsArtifactV1Api);
      mockSidecarHandle.getFlinkArtifactsApi.returns(flinkArtifactsApiStub);

      sandbox.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);

      // By default, cache misses for Flink artifacts.
      stubbedResourceManager.getFlinkArtifacts.resolves(undefined);
    });

    it("should handle zero artifacts to list", async () => {
      // Simulate zero available artifacts.
      const mockResponse = makeFakeListArtifactsResponse(false, 0);

      flinkArtifactsApiStub.listArtifactV1FlinkArtifacts.resolves(mockResponse);

      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);
      assert.strictEqual(artifacts.length, 0);
      sinon.assert.calledOnce(flinkArtifactsApiStub.listArtifactV1FlinkArtifacts);
      sinon.assert.calledOnce(stubbedResourceManager.getFlinkArtifacts);

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
      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);
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
      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

      assert.strictEqual(artifacts.length, 5);

      sinon.assert.calledOnce(stubbedResourceManager.getFlinkArtifacts);
      sinon.assert.calledTwice(flinkArtifactsApiStub.listArtifactV1FlinkArtifacts);
    });

    it("should handle resourcemanager cache hit, then skipping the route call", async () => {
      stubbedResourceManager.getFlinkArtifacts.resolves([]); // empty array is easy cache fodder.

      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

      assert.strictEqual(artifacts.length, 0);

      sinon.assert.calledOnce(stubbedResourceManager.getFlinkArtifacts);
      sinon.assert.notCalled(flinkArtifactsApiStub.listArtifactV1FlinkArtifacts);
    });

    it("should honor forceDeepRefresh=true to skip cache and reload", async () => {
      const mockResponse = makeFakeListArtifactsResponse(false, 3);
      flinkArtifactsApiStub.listArtifactV1FlinkArtifacts.resolves(mockResponse);
      stubbedResourceManager.getFlinkArtifacts.resolves([]); // would be a cache hit, but...

      // call with forceDeepRefresh=true
      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);
      assert.strictEqual(artifacts.length, 3);

      // Will have consulted the cache, but then ignored it, and called the API, then cached the results.
      sinon.assert.calledOnce(stubbedResourceManager.getFlinkArtifacts);
      sinon.assert.calledOnce(flinkArtifactsApiStub.listArtifactV1FlinkArtifacts);
      sinon.assert.calledOnce(stubbedResourceManager.setFlinkArtifacts);
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
  });

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

  describe("getFlinkDatabases", () => {
    let getKafkaClustersStub: sinon.SinonStub;

    beforeEach(() => {
      getKafkaClustersStub = sandbox.stub(loader, "getKafkaClusters");
    });

    it("should return all Flink databases when no environmentId is provided", async () => {
      // Kafka clusters that pass the isFlinkable() check
      const cluster1: CCloudKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
      const cluster2: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        id: "lkc-flink-db-2",
        name: "test-flink-db-cluster-2",
      });
      getKafkaClustersStub.resolves([cluster1, cluster2]);

      const databases: CCloudFlinkDbKafkaCluster[] = await loader.getFlinkDatabases();

      assert.strictEqual(databases.length, 2);
      assert.deepStrictEqual(databases, [cluster1, cluster2]);
      sinon.assert.calledOnce(getKafkaClustersStub);
    });

    it("should return filtered Flink databases when an environmentId is provided", async () => {
      const targetEnvironmentId = "env-target" as EnvironmentId;
      const cluster1: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        id: "lkc-flink-db-1",
        name: "test-flink-db-cluster-1",
        environmentId: targetEnvironmentId,
      });
      const cluster2: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        id: "lkc-flink-db-2",
        name: "test-flink-db-cluster-2",
        environmentId: "env-other" as EnvironmentId,
      });
      getKafkaClustersStub.resolves([cluster1, cluster2]);

      const databases: CCloudFlinkDbKafkaCluster[] =
        await loader.getFlinkDatabases(targetEnvironmentId);

      assert.strictEqual(databases.length, 1);
      assert.deepStrictEqual(databases[0], cluster1);
      sinon.assert.calledOnce(getKafkaClustersStub);
    });

    it("should return an empty array when no underlying Kafka clusters are available", async () => {
      getKafkaClustersStub.resolves([]);

      const databases: CCloudFlinkDbKafkaCluster[] = await loader.getFlinkDatabases();

      assert.strictEqual(databases.length, 0);
      assert.deepStrictEqual(databases, []);
      sinon.assert.calledOnce(getKafkaClustersStub);
    });

    it("should return an empty array when no databases match the provided environmentId", async () => {
      getKafkaClustersStub.resolves([TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER]);

      const databases: CCloudFlinkDbKafkaCluster[] = await loader.getFlinkDatabases(
        "some-other-env-id" as EnvironmentId,
      );

      assert.strictEqual(databases.length, 0);
      sinon.assert.calledOnce(getKafkaClustersStub);
    });
  });

  describe("getFlinkDatabase", () => {
    let getFlinkDatabasesStub: sinon.SinonStub;

    beforeEach(() => {
      getFlinkDatabasesStub = sandbox.stub(loader, "getFlinkDatabases");
    });

    it("should return the database with matching environment and database IDs", async () => {
      const database1: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
      const database2: CCloudFlinkDbKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        environmentId: "other-env-id" as EnvironmentId,
      }) as CCloudFlinkDbKafkaCluster;
      // same cluster/database IDs, different environment IDs
      getFlinkDatabasesStub.resolves([database1, database2]);

      const result: CCloudFlinkDbKafkaCluster | undefined = await loader.getFlinkDatabase(
        database1.environmentId,
        database1.id,
      );

      assert.strictEqual(result, database1);
      sinon.assert.calledOnceWithExactly(getFlinkDatabasesStub, database1.environmentId);
    });

    it("should return undefined when no databases match the provided database ID", async () => {
      const database1: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
      getFlinkDatabasesStub.resolves([database1]);

      const result: CCloudFlinkDbKafkaCluster | undefined = await loader.getFlinkDatabase(
        database1.environmentId,
        "some-other-db-id",
      );

      assert.strictEqual(result, undefined);
      sinon.assert.calledOnceWithExactly(getFlinkDatabasesStub, database1.environmentId);
    });

    it("should return undefined when no databases are available", async () => {
      getFlinkDatabasesStub.resolves([]);

      const envId = "env1" as EnvironmentId;
      const result: CCloudFlinkDbKafkaCluster | undefined = await loader.getFlinkDatabase(
        envId,
        "db-id",
      );

      assert.strictEqual(result, undefined);
      sinon.assert.calledOnceWithExactly(getFlinkDatabasesStub, envId);
    });
  });

  describe("executeFlinkStatement", () => {
    let submitFlinkStatementStub: sinon.SinonStub;
    let waitForStatementCompletionStub: sinon.SinonStub;
    let parseAllFlinkStatementResultsStub: sinon.SinonStub;

    interface TestResult {
      EXPR0: number;
    }

    beforeEach(() => {
      submitFlinkStatementStub = sandbox.stub(statementUtils, "submitFlinkStatement");
      waitForStatementCompletionStub = sandbox.stub(statementUtils, "waitForStatementCompletion");
      parseAllFlinkStatementResultsStub = sandbox.stub(
        statementUtils,
        "parseAllFlinkStatementResults",
      );
      sinon.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);
    });

    it("should throw if provided compute pool is for different cloud/region", async () => {
      const differentCloudComputePool = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        provider: "nonexistent",
        region: "us-central1",
      });

      await assert.rejects(
        loader.executeFlinkStatement("SELECT 1", TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, {
          computePool: differentCloudComputePool,
        }),
        /is not in the same cloud/,
      );
    });

    it("should default to first compute pool if none provided then run successfully through", async () => {
      // Sanity check to ensure test setup is correct.
      assert.strictEqual(
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.flinkPools[0].id,
        TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      );

      const completedStatement = { phase: Phase.COMPLETED } as FlinkStatement;
      waitForStatementCompletionStub.resolves(completedStatement);

      const parseResults: Array<TestResult> = [{ EXPR0: 1 }];
      parseAllFlinkStatementResultsStub.returns(parseResults);

      const returnedResults = await loader.executeFlinkStatement<TestResult>(
        "SELECT 1",
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      );

      assert.deepStrictEqual(returnedResults, parseResults);

      sinon.assert.calledOnce(submitFlinkStatementStub);

      const callArgs = submitFlinkStatementStub.getCall(0).args[0];
      assert.strictEqual(callArgs.computePool?.id, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);

      sinon.assert.calledOnce(waitForStatementCompletionStub);
      sinon.assert.calledOnce(parseAllFlinkStatementResultsStub);
      assert.deepStrictEqual(
        parseAllFlinkStatementResultsStub.getCall(0).args[0],
        completedStatement,
      );
    });

    it("should throw if statement does not complete successfully", async () => {
      const failedStatement = createFlinkStatement({ phase: Phase.FAILED });
      waitForStatementCompletionStub.resolves(failedStatement);

      await assert.rejects(
        loader.executeFlinkStatement<TestResult>("SELECT 1", TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER),
        /did not complete successfully/,
      );

      sinon.assert.calledOnce(waitForStatementCompletionStub);
      sinon.assert.calledOnce(submitFlinkStatementStub);
      sinon.assert.notCalled(parseAllFlinkStatementResultsStub);
    });

    it("should override timeout if provided", async () => {
      const completedStatement = createFlinkStatement({ phase: Phase.COMPLETED });
      waitForStatementCompletionStub.resolves(completedStatement);

      const parseResults: Array<TestResult> = [{ EXPR0: 1 }];
      parseAllFlinkStatementResultsStub.returns(parseResults);

      const customTimeout = 10;

      await loader.executeFlinkStatement<TestResult>(
        "SELECT 1",
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        { timeout: customTimeout },
      );
      sinon.assert.calledOnce(submitFlinkStatementStub);
      sinon.assert.calledOnce(waitForStatementCompletionStub);
      const waitCallArgs = waitForStatementCompletionStub.getCall(0).args;
      assert.strictEqual(waitCallArgs[1], customTimeout);
    });

    describe("concurrency handling", () => {
      beforeEach(() => {
        // Set up any submitted statement to complete successfully
        const completedStatement = { phase: Phase.COMPLETED } as FlinkStatement;
        waitForStatementCompletionStub.resolves(completedStatement);

        const parseResults: Array<TestResult> = [{ EXPR0: 1 }];
        parseAllFlinkStatementResultsStub.returns(parseResults);
      });

      it("should return same promise if called multiple times concurrently", async () => {
        const promise1 = loader.executeFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        );
        const promise2 = loader.executeFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        );

        await Promise.all([promise1, promise2]);

        // waitForStatementCompletionStub, parseAllFlinkStatementResultsStub should have only be called once
        // since both calls should share the same promise.
        sinon.assert.calledOnce(waitForStatementCompletionStub);
        sinon.assert.calledOnce(parseAllFlinkStatementResultsStub);
      });

      it("should issue separate calls if called with different statements concurrently", async () => {
        const promise1 = loader.executeFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        );
        const promise2 = loader.executeFlinkStatement<TestResult>(
          "SELECT 2",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        );

        await Promise.all([promise1, promise2]);

        // waitForStatementCompletionStub, parseAllFlinkStatementResultsStub should have been called twice
        // since both calls should have been independent (separate statements).
        sinon.assert.calledTwice(waitForStatementCompletionStub);
        sinon.assert.calledTwice(parseAllFlinkStatementResultsStub);
      });

      it("pending promise map should be cleared after successful completion", async () => {
        await loader.executeFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        );

        assert.strictEqual(
          loader["backgroundStatementPromises"].size,
          0,
          "Expected pending promise map to be cleared",
        );
      });

      it("pending promise map should be cleared after failure", async () => {
        waitForStatementCompletionStub.rejects(new Error("Simulated failure"));

        await assert.rejects(async () => {
          await loader.executeFlinkStatement<TestResult>(
            "SELECT 1",
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          );
        });

        assert.strictEqual(
          loader["backgroundStatementPromises"].size,
          0,
          "Expected pending promise map to be cleared",
        );
      });
    });
  });
});
