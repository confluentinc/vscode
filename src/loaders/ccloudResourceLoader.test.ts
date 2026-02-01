import assert from "assert";
import * as sinon from "sinon";

import type { StubbedEventEmitters } from "../../tests/stubs/emitters";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedResourceManager } from "../../tests/stubs/extensionStorage";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { CCLOUD_CONNECTION_ID } from "../constants";
import * as contextValues from "../context/values";
import * as ccloudResourceFetcher from "../fetchers/ccloudResourceFetcher";
import * as organizationFetcher from "../fetchers/organizationFetcher";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { FlinkStatement } from "../models/flinkStatement";
import { Phase } from "../models/flinkStatement";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import type { EnvironmentId, IFlinkQueryable } from "../models/resource";
// TODO: Re-enable when sidecar handle is restored (sidecar removal migration)
// import { getSidecarHandle, type SidecarHandle } from "../connections";
import type { ResourceManager } from "../storage/resourceManager";
import { CachingResourceLoader } from "./cachingResourceLoader";

import { createFlinkAIAgent } from "../../tests/unit/testResources/flinkAIAgent";
import { createFlinkAIConnection } from "../../tests/unit/testResources/flinkAIConnection";
import { createFlinkAITool } from "../../tests/unit/testResources/flinkAITool";
import { TEST_FLINK_RELATION } from "../../tests/unit/testResources/flinkRelation";
import { createFlinkUDF } from "../../tests/unit/testResources/flinkUDF";
import { TokenManager } from "../authn/oauth2/tokenManager";
import type { FlinkWorkspaceParams } from "../flinkSql/flinkWorkspace";
import type { FlinkAIAgent } from "../models/flinkAiAgent";
import type { FlinkAIConnection } from "../models/flinkAiConnection";
import type { FlinkDatabaseResource } from "../models/flinkDatabaseResource";
import type { FlinkRelation } from "../models/flinkRelation";
import type { FlinkUdf } from "../models/flinkUDF";
import {
  CCloudDataPlaneProxy,
  HttpError,
  type FlinkStatement as FlinkStatementApi,
} from "../proxy";
import type { FlinkArtifactData } from "../proxy/ccloudArtifactsProxy";
import * as ccloudArtifactsProxy from "../proxy/ccloudArtifactsProxy";
import {
  CCloudControlPlaneProxy,
  type CCloudFlinkRegionData,
} from "../proxy/ccloudControlPlaneProxy";
import { WorkspaceStorageKeys } from "../storage/constants";
import {
  CCloudResourceLoader,
  loadProviderRegions,
  SKIP_RESULTS_SQL_KINDS,
  type StatementExecutionDeps,
} from "./ccloudResourceLoader";
import * as aiAgentsQueryUtils from "./utils/flinkAiAgentsQuery";
import * as aiConnectionsQueryUtils from "./utils/flinkAiConnectionsQuery";
import * as aiModelsQueryUtils from "./utils/flinkAiModelsQuery";
import * as aiToolsQueryUtils from "./utils/flinkAiToolsQuery";
import * as relationsQueryUtils from "./utils/relationsAndColumnsSystemCatalogQuery";
import * as udfQueryUtils from "./utils/udfSystemCatalogQuery";

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
    let getContextValueStub: sinon.SinonStub;

    beforeEach(() => {
      resetStub = sandbox.stub(loader, "reset").resolves();
      ensureCoarseResourcesLoadedStub = sandbox
        .stub(loader as any, "ensureCoarseResourcesLoaded")
        .resolves();
      // Stub getContextValue to return true for ccloudConnectionAvailable by default
      getContextValueStub = sandbox.stub(contextValues, "getContextValue").returns(true);
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

    it("should not call ensureCoarseResourcesLoaded when connected is true but no auth session", async () => {
      getContextValueStub.returns(false);
      await loader.ccloudConnectedHandler(true);
      sinon.assert.notCalled(ensureCoarseResourcesLoadedStub);
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
      getCurrentOrganizationStub = sandbox.stub(organizationFetcher, "getCurrentOrganization");
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
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let fetchAllStatementsStub: sinon.SinonStub;

    beforeEach(() => {
      sandbox.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);

      // Stub TokenManager to return a data plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub determineFlinkQueryables to return a single queryable
      sandbox.stub(loader, "determineFlinkQueryables").resolves([
        {
          organizationId: TEST_CCLOUD_ORGANIZATION.id,
          environmentId: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
          provider: TEST_CCLOUD_FLINK_COMPUTE_POOL.provider,
          region: TEST_CCLOUD_FLINK_COMPUTE_POOL.region,
          computePoolId: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
        },
      ]);

      // Stub the CCloudDataPlaneProxy.prototype.fetchAllStatements method
      fetchAllStatementsStub = sandbox
        .stub(CCloudDataPlaneProxy.prototype, "fetchAllStatements")
        .resolves([]);
    });

    it("Handles zero statements to list", async () => {
      fetchAllStatementsStub.resolves([]);

      const statements = await loader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(statements.length, 0);
      sinon.assert.calledOnce(fetchAllStatementsStub);

      // Check that the correct options were passed
      const callArgs = fetchAllStatementsStub.firstCall.args[0];
      assert.strictEqual(callArgs.computePoolId, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
      assert.strictEqual(callArgs.labelSelector, "user.confluent.io/hidden!=true");
    });

    it("Handles statements from proxy", async () => {
      // Create mock proxy statements
      const mockStatements: FlinkStatementApi[] = makeFakeStatements(3);
      fetchAllStatementsStub.resolves(mockStatements);

      const statements = await loader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(statements.length, 3);
      sinon.assert.calledOnce(fetchAllStatementsStub);
    });

    it("Returns empty array when no data plane token", async () => {
      tokenManagerStub.getDataPlaneToken.resolves(null);

      const statements = await loader.getFlinkStatements(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(statements.length, 0);
      sinon.assert.notCalled(fetchAllStatementsStub);
    });

    /** Create fake Flink statements for testing. */
    function makeFakeStatements(count: number): FlinkStatementApi[] {
      const statements: FlinkStatementApi[] = [];
      for (let i = 0; i < count; i++) {
        statements.push({
          api_version: "sql/v1",
          kind: "Statement",
          name: `statement-${i}`,
          organization_id: TEST_CCLOUD_ORGANIZATION.id,
          environment_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
          spec: {
            compute_pool_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
            statement: `SELECT * FROM table_${i}`,
            properties: {},
          },
          status: {
            phase: "RUNNING",
            traits: {
              sql_kind: "SELECT",
            },
          },
          metadata: {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
      }
      return statements;
    }
  });

  describe("refreshFlinkStatement()", () => {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let getStatementStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager to return a data plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub the CCloudDataPlaneProxy.prototype.getStatement method
      getStatementStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "getStatement");
    });

    it("should return the statement if found", async () => {
      // Create a mock API response
      const mockApiStatement: FlinkStatementApi = {
        api_version: "sql/v1",
        kind: "Statement",
        name: "test-statement",
        organization_id: TEST_CCLOUD_ORGANIZATION.id,
        environment_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
        spec: {
          compute_pool_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
          statement: "SELECT * FROM test_table",
          properties: {},
        },
        status: {
          phase: "RUNNING",
          traits: {
            sql_kind: "SELECT",
          },
        },
        metadata: {
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };

      getStatementStub.resolves(mockApiStatement);

      const inputStatement = createFlinkStatement({ name: "test-statement" });
      const updatedStatement = await loader.refreshFlinkStatement(inputStatement);

      assert.ok(updatedStatement);
      assert.strictEqual(updatedStatement.name, "test-statement");
      sinon.assert.calledOnce(getStatementStub);
    });

    it("should return null if statement is not found", async () => {
      // Simulate a 404 error from the proxy
      // HttpError constructor: (message, status, statusText, data?, headers?)
      getStatementStub.rejects(new HttpError("Statement not found", 404, "Not Found"));

      const shouldBeNull = await loader.refreshFlinkStatement(createFlinkStatement());
      assert.strictEqual(shouldBeNull, null);
    });

    it("Should raise if non-404 error occurs", async () => {
      // Simulate a 500 error from the proxy
      getStatementStub.rejects(new HttpError("Server error", 500, "Internal Server Error"));

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
    let mockFetcher: { fetchEnvironments: sinon.SinonStub };
    let getCurrentOrganizationStub: sinon.SinonStub;

    beforeEach(() => {
      // Create mock fetcher and stub createCCloudResourceFetcher
      mockFetcher = {
        fetchEnvironments: sandbox.stub(),
      };
      sandbox
        .stub(ccloudResourceFetcher, "createCCloudResourceFetcher")
        .returns(mockFetcher as any);
      getCurrentOrganizationStub = sandbox.stub(organizationFetcher, "getCurrentOrganization");
    });

    it("does nothing when no CCloud org is available", async () => {
      mockFetcher.fetchEnvironments.resolves([]);
      getCurrentOrganizationStub.resolves(undefined);

      await loader["doLoadCoarseResources"]();
      sinon.assert.calledOnce(mockFetcher.fetchEnvironments);
      sinon.assert.calledOnce(getCurrentOrganizationStub);
      assert.strictEqual(loader["organization"], null);
    });

    it("should set CCloud resources when available", async () => {
      mockFetcher.fetchEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);
      getCurrentOrganizationStub.resolves(TEST_CCLOUD_ORGANIZATION);

      await loader["doLoadCoarseResources"]();

      sinon.assert.calledOnce(mockFetcher.fetchEnvironments);
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
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let fetchAllArtifactsStub: sinon.SinonStub;

    const testQueryable: IFlinkQueryable = {
      organizationId: TEST_CCLOUD_ORGANIZATION.id,
      environmentId: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
      provider: TEST_CCLOUD_FLINK_COMPUTE_POOL.provider,
      region: TEST_CCLOUD_FLINK_COMPUTE_POOL.region,
    };

    beforeEach(() => {
      // Stub TokenManager to return a data plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub the proxy creation and its methods
      fetchAllArtifactsStub = sandbox.stub();
      sandbox.stub(ccloudArtifactsProxy, "createCCloudArtifactsProxy").returns({
        fetchAllArtifacts: fetchAllArtifactsStub,
      } as any);
    });

    it("should return empty array when API returns empty data", async () => {
      fetchAllArtifactsStub.resolves([]);
      const { loadArtifactsForProviderRegion } = await import("./ccloudResourceLoader");

      const artifacts = await loadArtifactsForProviderRegion(null, testQueryable);

      assert.ok(Array.isArray(artifacts));
      assert.strictEqual(artifacts.length, 0);
      sinon.assert.calledOnce(fetchAllArtifactsStub);
    });

    it("should return artifacts when API returns data", async () => {
      const mockArtifactData: FlinkArtifactData[] = [
        {
          id: "artifact-1",
          cloud: "aws",
          region: "us-east-1",
          environment: "env-12345",
          display_name: "Test Artifact 1",
          description: "Test description",
          metadata: {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      ];
      fetchAllArtifactsStub.resolves(mockArtifactData);
      const { loadArtifactsForProviderRegion } = await import("./ccloudResourceLoader");

      const artifacts = await loadArtifactsForProviderRegion(null, testQueryable);

      assert.strictEqual(artifacts.length, 1);
      assert.strictEqual(artifacts[0].id, "artifact-1");
      assert.strictEqual(artifacts[0].name, "Test Artifact 1");
      sinon.assert.calledOnce(fetchAllArtifactsStub);
    });

    it("should return empty array when not authenticated", async () => {
      tokenManagerStub.getDataPlaneToken.resolves(null);
      const { loadArtifactsForProviderRegion } = await import("./ccloudResourceLoader");

      const artifacts = await loadArtifactsForProviderRegion(null, testQueryable);

      assert.strictEqual(artifacts.length, 0);
      sinon.assert.notCalled(fetchAllArtifactsStub);
    });

    it("should pass correct parameters to proxy", async () => {
      fetchAllArtifactsStub.resolves([]);
      const { loadArtifactsForProviderRegion } = await import("./ccloudResourceLoader");

      await loadArtifactsForProviderRegion(null, testQueryable);

      sinon.assert.calledOnce(fetchAllArtifactsStub);
      const args = fetchAllArtifactsStub.getCall(0).args[0];
      assert.strictEqual(args.cloud, testQueryable.provider);
      assert.strictEqual(args.region, testQueryable.region);
      assert.strictEqual(args.environment, testQueryable.environmentId);
    });
  });

  describe("getFlinkDatabaseResources()", () => {
    let executeBackgroundFlinkStatementStub: sinon.SinonStub;

    const testDatabase = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
    const testStorageKey = "test-resource" as WorkspaceStorageKeys;
    const testStatementQuery = "SELECT * FROM database_resources;";
    // simple transformer function that converts the 'id' value to uppercase to add to the 'idUpper'
    // field and adds the databaseId to each row/resource
    const testTransformer = (db: CCloudFlinkDbKafkaCluster, rows: any[]): any[] => {
      return rows.map((r) => ({
        id: r.id,
        idUpper: r.id.toUpperCase(),
        databaseId: db.id,
      }));
    };

    beforeEach(() => {
      executeBackgroundFlinkStatementStub = sandbox.stub(loader, "executeBackgroundFlinkStatement");
    });

    it("should return an empty array when the background statement returns no results", async () => {
      const emptyRows: any[] = [];
      executeBackgroundFlinkStatementStub.resolves(emptyRows);

      const resources = await loader["getFlinkDatabaseResources"](
        testDatabase,
        testStorageKey,
        testStatementQuery,
        () => [],
        false,
        // no statement options by default
      );

      assert.ok(Array.isArray(resources));
      assert.strictEqual(resources.length, 0);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
      );
      sinon.assert.calledOnceWithExactly(
        executeBackgroundFlinkStatementStub,
        testStatementQuery,
        testDatabase,
        undefined,
      );
      // no transformations applied since there are no rows
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
        resources,
      );
    });

    it("should return transformed resources when the background statement returns results", async () => {
      const rawResultRows = [{ id: "abc" }, { id: "def" }];
      executeBackgroundFlinkStatementStub.resolves(rawResultRows);

      const resources = await loader["getFlinkDatabaseResources"](
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        testStorageKey,
        testStatementQuery,
        testTransformer,
        false,
        // no statement options by default
      );

      assert.ok(Array.isArray(resources));
      assert.strictEqual(resources.length, rawResultRows.length);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
      );
      sinon.assert.calledOnceWithExactly(
        executeBackgroundFlinkStatementStub,
        testStatementQuery,
        testDatabase,
        undefined,
      );
      // verify that the transformation was applied correctly
      for (let i = 0; i < rawResultRows.length; i++) {
        assert.strictEqual(resources[i].id, rawResultRows[i].id);
        assert.strictEqual(resources[i].idUpper, rawResultRows[i].id.toUpperCase());
        assert.strictEqual(resources[i].databaseId, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id);
      }
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
        resources,
      );
    });

    it("should return cached resources without executing a background statement", async () => {
      const cachedResources = [{ id: "cached1" }, { id: "cached2" }] as FlinkDatabaseResource[];
      stubbedResourceManager.getFlinkDatabaseResources.resolves(cachedResources);

      const resources = await loader["getFlinkDatabaseResources"](
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        testStorageKey,
        testStatementQuery,
        testTransformer,
        false,
      );

      assert.deepStrictEqual(resources, cachedResources);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
      );
      sinon.assert.notCalled(executeBackgroundFlinkStatementStub);
      sinon.assert.notCalled(stubbedResourceManager.setFlinkDatabaseResources);
    });

    it("should execute a background statement and update the cache when forceDeepRefresh=true", async () => {
      const rawResultRows = [{ id: "A" }, { id: "B" }];
      executeBackgroundFlinkStatementStub.resolves(rawResultRows);

      const resources = await loader["getFlinkDatabaseResources"](
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        testStorageKey,
        testStatementQuery,
        testTransformer,
        true,
      );

      assert.ok(Array.isArray(resources));
      assert.strictEqual(resources.length, rawResultRows.length);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
      );
      sinon.assert.calledOnceWithExactly(
        executeBackgroundFlinkStatementStub,
        testStatementQuery,
        testDatabase,
        undefined,
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
        resources,
      );
    });

    it("should execute a background statement when forceDeepRefresh=false with no cached data (cache miss)", async () => {
      // nothing cached
      stubbedResourceManager.getFlinkDatabaseResources.resolves(undefined);
      // but statement returns results
      const rawResultRows = [{ id: "X" }];
      executeBackgroundFlinkStatementStub.resolves(rawResultRows);

      const resources = await loader["getFlinkDatabaseResources"](
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        testStorageKey,
        testStatementQuery,
        testTransformer,
        false,
      );

      assert.ok(Array.isArray(resources));
      assert.strictEqual(resources.length, 1);
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
      );
      sinon.assert.calledOnceWithExactly(
        executeBackgroundFlinkStatementStub,
        testStatementQuery,
        testDatabase,
        undefined,
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
        resources,
      );
    });

    it("should pass custom statement options to executeBackgroundFlinkStatement", async () => {
      const rawResultRows = [{ id: "test" }];
      executeBackgroundFlinkStatementStub.resolves(rawResultRows);
      const customOptions = { timeout: 5000 };

      const resources = await loader["getFlinkDatabaseResources"](
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        testStorageKey,
        testStatementQuery,
        testTransformer,
        false,
        customOptions,
      );

      assert.ok(Array.isArray(resources));
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
      );
      sinon.assert.calledOnceWithExactly(
        executeBackgroundFlinkStatementStub,
        testStatementQuery,
        testDatabase,
        customOptions, // verify custom options were passed
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
        resources,
      );
    });

    it("should use the transformer function correctly when processing results", async () => {
      const rawResultRows = [{ input: "hello" }, { input: "world" }];
      executeBackgroundFlinkStatementStub.resolves(rawResultRows);
      // different transformer function for this test
      const customTransformer = (db: CCloudFlinkDbKafkaCluster, rows: any[]): any[] => {
        return rows.map((r) => ({
          transformed: r.input.toUpperCase(),
          reversed: r.input.split("").reverse().join(""),
          databaseId: db.id,
        }));
      };

      const resources = await loader["getFlinkDatabaseResources"](
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        testStorageKey,
        testStatementQuery,
        customTransformer,
        false,
      );

      assert.strictEqual(resources.length, 2);
      assert.strictEqual(resources[0].transformed, "HELLO");
      assert.strictEqual(resources[0].reversed, "olleh");
      assert.strictEqual(resources[1].transformed, "WORLD");
      assert.strictEqual(resources[1].reversed, "dlrow");
      assert.strictEqual(resources[0].databaseId, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id);
    });

    it("should execute a background statement when forceDeepRefresh=true even with cached data", async () => {
      const cachedResources = [{ id: "old" }] as FlinkDatabaseResource[];
      stubbedResourceManager.getFlinkDatabaseResources.resolves(cachedResources);
      const freshResults = [{ id: "new1" }, { id: "new2" }];
      executeBackgroundFlinkStatementStub.resolves(freshResults);

      const resources = await loader["getFlinkDatabaseResources"](
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        testStorageKey,
        testStatementQuery,
        testTransformer,
        true,
      );

      assert.ok(Array.isArray(resources));
      assert.strictEqual(resources.length, 2);
      assert.strictEqual(resources[0].id, "new1");
      assert.strictEqual(resources[1].id, "new2");
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
      );
      sinon.assert.calledOnceWithExactly(
        executeBackgroundFlinkStatementStub,
        testStatementQuery,
        testDatabase,
        undefined,
      );
      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.setFlinkDatabaseResources,
        testDatabase,
        testStorageKey,
        resources,
      );
    });
  });

  describe("getFlinkDatabaseResources() wrapper methods", () => {
    let loaderGetDbResourcesStub: sinon.SinonStub;

    beforeEach(() => {
      // this time we're stubbing the loader's getFlinkDatabaseResources method, not the one from
      // the ResourceManager (which is already stubbed through stubbedResourceManager)
      loaderGetDbResourcesStub = sandbox.stub();
      loader["getFlinkDatabaseResources"] = loaderGetDbResourcesStub;
    });

    describe("getFlinkUDFs()", () => {
      for (const forceDeepRefresh of [true, false]) {
        it(`should call getFlinkDatabaseResources() with correct parameters (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          const testUdfs: FlinkUdf[] = [createFlinkUDF("udf1")];
          loaderGetDbResourcesStub.resolves(testUdfs);

          const result = await loader.getFlinkUDFs(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          assert.deepStrictEqual(result, testUdfs);
          sinon.assert.calledOnceWithMatch(
            loaderGetDbResourcesStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            WorkspaceStorageKeys.FLINK_UDFS,
            udfQueryUtils.getUdfSystemCatalogQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER),
            sinon.match.func,
            forceDeepRefresh,
            { nameSpice: "list-udfs" },
          );
        });
      }
    });

    describe("getFlinkAIModels()", () => {
      for (const forceDeepRefresh of [true, false]) {
        it(`should call getFlinkDatabaseResources() with correct parameters (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          const testUdfs: FlinkUdf[] = [createFlinkUDF("udf1")];
          loaderGetDbResourcesStub.resolves(testUdfs);

          const result = await loader.getFlinkAIModels(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          assert.deepStrictEqual(result, testUdfs);
          sinon.assert.calledOnceWithMatch(
            loaderGetDbResourcesStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            WorkspaceStorageKeys.FLINK_AI_MODELS,
            aiModelsQueryUtils.getFlinkAIModelsQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER),
            sinon.match.func,
            forceDeepRefresh,
            // no statement options
          );
        });
      }
    });

    describe("getFlinkAITools()", () => {
      for (const forceDeepRefresh of [true, false]) {
        it(`should call getFlinkDatabaseResources() with correct parameters (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          const testTools = [createFlinkAITool("tool1")];
          loaderGetDbResourcesStub.resolves(testTools);

          const result = await loader.getFlinkAITools(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          assert.deepStrictEqual(result, testTools);
          sinon.assert.calledOnceWithMatch(
            loaderGetDbResourcesStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            WorkspaceStorageKeys.FLINK_AI_TOOLS,
            aiToolsQueryUtils.getFlinkAIToolsQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER),
            sinon.match.func,
            forceDeepRefresh,
            // no statement options
          );
        });
      }
    });

    describe("getFlinkAIConnections()", () => {
      for (const forceDeepRefresh of [true, false]) {
        it(`should call getFlinkDatabaseResources() with correct parameters (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          const testConnections: FlinkAIConnection[] = [createFlinkAIConnection("connection1")];
          loaderGetDbResourcesStub.resolves(testConnections);

          const result = await loader.getFlinkAIConnections(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          assert.deepStrictEqual(result, testConnections);
          sinon.assert.calledOnceWithMatch(
            loaderGetDbResourcesStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            WorkspaceStorageKeys.FLINK_AI_CONNECTIONS,
            aiConnectionsQueryUtils.getFlinkAIConnectionsQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER),
            sinon.match.func,
            forceDeepRefresh,
            // no statement options
          );
        });
      }
    });

    describe("getFlinkAIAgents()", () => {
      for (const forceDeepRefresh of [true, false]) {
        it(`should call getFlinkDatabaseResources() with correct parameters (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          const testAgents: FlinkAIAgent[] = [createFlinkAIAgent("agent1")];
          loaderGetDbResourcesStub.resolves(testAgents);

          const result = await loader.getFlinkAIAgents(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          assert.deepStrictEqual(result, testAgents);
          sinon.assert.calledOnceWithMatch(
            loaderGetDbResourcesStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            WorkspaceStorageKeys.FLINK_AI_AGENTS,
            aiAgentsQueryUtils.getFlinkAIAgentsQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER),
            sinon.match.func,
            forceDeepRefresh,
            // no statement options
          );
        });
      }
    });

    describe("getFlinkRelations()", () => {
      for (const forceDeepRefresh of [true, false]) {
        it(`should call getFlinkDatabaseResources() with correct parameters (forceDeepRefresh=${forceDeepRefresh})`, async () => {
          const testRelations: FlinkRelation[] = [TEST_FLINK_RELATION];
          loaderGetDbResourcesStub.resolves(testRelations);

          const result = await loader.getFlinkRelations(
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            forceDeepRefresh,
          );

          assert.deepStrictEqual(result, testRelations);
          sinon.assert.calledOnceWithMatch(
            loaderGetDbResourcesStub,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            WorkspaceStorageKeys.FLINK_RELATIONS,
            relationsQueryUtils.getRelationsAndColumnsSystemCatalogQuery(
              TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            ),
            sinon.match.func,
            forceDeepRefresh,
            // no statement options
          );
        });
      }
    });
  });

  describe("getFlinkDatabaseResource() wrappers' transformers", () => {
    beforeEach(() => {
      // prevent actual statement execution; we don't care about the args or results here since
      // they're tested in the getFlinkDatabaseResources() suite
      sandbox.stub(loader, "executeBackgroundFlinkStatement").resolves([]);
    });

    it("getFlinkRelations() should use parseRelationsAndColumnsSystemCatalogQueryResponse", async () => {
      const parseRelationsAndColumnsSystemCatalogQueryResponseSpy = sandbox.spy(
        relationsQueryUtils,
        "parseRelationsAndColumnsSystemCatalogQueryResponse",
      );

      // force refresh to call executeBackgroundFlinkStatement+transformer+setFlinkDatabaseResources
      await loader.getFlinkRelations(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);

      sinon.assert.calledOnce(parseRelationsAndColumnsSystemCatalogQueryResponseSpy);
    });

    it("getFlinkUDFs() should use transformUdfSystemCatalogRows", async () => {
      const transformUdfSystemCatalogRowsSpy = sandbox.spy(
        udfQueryUtils,
        "transformUdfSystemCatalogRows",
      );

      // force refresh to call executeBackgroundFlinkStatement+transformer+setFlinkDatabaseResources
      await loader.getFlinkUDFs(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);

      sinon.assert.calledOnce(transformUdfSystemCatalogRowsSpy);
    });

    it("getFlinkAIModels() should use transformRawFlinkAIModelRows", async () => {
      const transformRawFlinkAIModelRowsSpy = sandbox.spy(
        aiModelsQueryUtils,
        "transformRawFlinkAIModelRows",
      );

      // force refresh to call executeBackgroundFlinkStatement+transformer+setFlinkDatabaseResources
      await loader.getFlinkAIModels(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);

      sinon.assert.calledOnce(transformRawFlinkAIModelRowsSpy);
    });

    it("getFlinkAITools() should use transformRawFlinkAIToolRows", async () => {
      const transformRawFlinkAIToolRowsSpy = sandbox.spy(
        aiToolsQueryUtils,
        "transformRawFlinkAIToolRows",
      );

      // force refresh to call executeBackgroundFlinkStatement+transformer+setFlinkDatabaseResources
      await loader.getFlinkAITools(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);

      sinon.assert.calledOnce(transformRawFlinkAIToolRowsSpy);
    });

    it("getFlinkAIConnections() should use transformRawFlinkAIConnectionRows", async () => {
      const transformRawFlinkAIConnectionRowsSpy = sandbox.spy(
        aiConnectionsQueryUtils,
        "transformRawFlinkAIConnectionRows",
      );

      // force refresh to call executeBackgroundFlinkStatement+transformer+setFlinkDatabaseResources
      await loader.getFlinkAIConnections(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);

      sinon.assert.calledOnce(transformRawFlinkAIConnectionRowsSpy);
    });

    it("getFlinkAIAgents() should use transformRawFlinkAIAgentRows", async () => {
      const transformRawFlinkAIAgentRowsSpy = sandbox.spy(
        aiAgentsQueryUtils,
        "transformRawFlinkAIAgentRows",
      );

      // force refresh to call executeBackgroundFlinkStatement+transformer+setFlinkDatabaseResources
      await loader.getFlinkAIAgents(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);

      sinon.assert.calledOnce(transformRawFlinkAIAgentRowsSpy);
    });
  });

  describe("getFlinkArtifacts", () => {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let createCCloudArtifactsProxyStub: sinon.SinonStub;
    let fetchAllArtifactsStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager to return a data plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      sandbox.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);

      // By default, cache misses for Flink artifacts.
      stubbedResourceManager.getFlinkArtifacts.resolves(undefined);

      // Stub the proxy creation and its methods
      fetchAllArtifactsStub = sandbox.stub();
      createCCloudArtifactsProxyStub = sandbox
        .stub(ccloudArtifactsProxy, "createCCloudArtifactsProxy")
        .returns({
          fetchAllArtifacts: fetchAllArtifactsStub,
        } as any);
    });

    it("should handle zero artifacts to list", async () => {
      // Simulate zero available artifacts.
      fetchAllArtifactsStub.resolves([]);

      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);
      assert.strictEqual(artifacts.length, 0);
      sinon.assert.calledOnce(createCCloudArtifactsProxyStub);
      sinon.assert.calledOnce(fetchAllArtifactsStub);
      sinon.assert.calledOnce(stubbedResourceManager.getFlinkArtifacts);

      // Test the args passed to the API.
      const args = fetchAllArtifactsStub.getCall(0).args[0];
      assert.ok(args, "Expected args to be defined");
      assert.strictEqual(args.cloud, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.provider);
      assert.strictEqual(args.region, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.region);
      assert.strictEqual(args.environment, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId);
    });

    it("should handle artifacts returned from API", async () => {
      // Simulate artifacts returned (the proxy handles pagination internally via fetchAllArtifacts)
      const mockArtifacts = makeFakeArtifacts(3);
      fetchAllArtifactsStub.resolves(mockArtifacts);

      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);
      assert.strictEqual(artifacts.length, 3);
      sinon.assert.calledOnce(fetchAllArtifactsStub);
    });

    it("should handle resourcemanager cache hit, then skipping the API call", async () => {
      stubbedResourceManager.getFlinkArtifacts.resolves([]); // empty array is easy cache fodder.

      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

      assert.strictEqual(artifacts.length, 0);

      sinon.assert.calledOnce(stubbedResourceManager.getFlinkArtifacts);
      sinon.assert.notCalled(fetchAllArtifactsStub);
    });

    it("should honor forceDeepRefresh=true to skip cache and reload", async () => {
      const mockArtifacts = makeFakeArtifacts(3);
      fetchAllArtifactsStub.resolves(mockArtifacts);
      stubbedResourceManager.getFlinkArtifacts.resolves([]); // would be a cache hit, but...

      // call with forceDeepRefresh=true
      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);
      assert.strictEqual(artifacts.length, 3);

      // Will have skipped the cache and called the API, then cached the results.
      sinon.assert.notCalled(stubbedResourceManager.getFlinkArtifacts);
      sinon.assert.calledOnce(fetchAllArtifactsStub);
      sinon.assert.calledOnce(stubbedResourceManager.setFlinkArtifacts);
    });

    it("should return empty array when not authenticated", async () => {
      tokenManagerStub.getDataPlaneToken.resolves(null);

      const artifacts = await loader.getFlinkArtifacts(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, false);

      assert.strictEqual(artifacts.length, 0);
      sinon.assert.notCalled(fetchAllArtifactsStub);
    });

    /** Make fake artifact data for testing. */
    function makeFakeArtifacts(count: number): FlinkArtifactData[] {
      const artifacts: FlinkArtifactData[] = [];

      for (let i = 0; i < count; i++) {
        artifacts.push({
          id: `artifact-${i}`,
          metadata: {
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            self: `https://api.confluent.cloud/artifact/v1/flink-artifacts/artifact-${i}`,
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

      return artifacts;
    }
  });

  describe("loadProviderRegions", () => {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let fetchAllFlinkRegionsStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager to return a control plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getControlPlaneToken.resolves("test-control-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub the proxy's fetchAllFlinkRegions method
      fetchAllFlinkRegionsStub = sandbox.stub(
        CCloudControlPlaneProxy.prototype,
        "fetchAllFlinkRegions",
      );
    });

    it("should handle zero regions to list", async () => {
      fetchAllFlinkRegionsStub.resolves([]);

      const regions = await loadProviderRegions();
      assert.strictEqual(regions.length, 0);
      sinon.assert.calledOnce(fetchAllFlinkRegionsStub);
    });

    it("should handle regions returned from API", async () => {
      // Simulate regions returned (the proxy handles pagination internally)
      const mockRegions = makeFakeRegionData(3);
      fetchAllFlinkRegionsStub.resolves(mockRegions);

      const regions = await loadProviderRegions();
      assert.strictEqual(regions.length, 3);
      sinon.assert.calledOnce(fetchAllFlinkRegionsStub);
    });

    it("should return empty array when not authenticated", async () => {
      tokenManagerStub.getControlPlaneToken.resolves(null);

      const regions = await loadProviderRegions();

      assert.strictEqual(regions.length, 0);
      sinon.assert.notCalled(fetchAllFlinkRegionsStub);
    });

    it("should return empty array on API error", async () => {
      const error = new Error("API request failed");
      fetchAllFlinkRegionsStub.rejects(error);

      // Now returns empty array instead of throwing
      const regions = await loadProviderRegions();
      assert.strictEqual(regions.length, 0);
    });

    it("should pass cloud filter when provided", async () => {
      fetchAllFlinkRegionsStub.resolves([]);

      await loadProviderRegions("aws");

      sinon.assert.calledOnce(fetchAllFlinkRegionsStub);
      sinon.assert.calledWith(fetchAllFlinkRegionsStub, "aws");
    });

    it("should correctly map API response to FcpmV2RegionListDataInner format", async () => {
      const mockRegions: CCloudFlinkRegionData[] = [
        {
          id: "region-1",
          api_version: "fcpm/v2",
          kind: "Region",
          metadata: { self: "https://api.confluent.cloud/fcpm/v2/regions/region-1" },
          display_name: "US West 2",
          cloud: "aws",
          region_name: "us-west-2",
          http_endpoint: "https://flink.us-west-2.aws.confluent.cloud",
          private_http_endpoint: "https://private-flink.us-west-2.aws.confluent.cloud",
        },
      ];
      fetchAllFlinkRegionsStub.resolves(mockRegions);

      const regions = await loadProviderRegions();

      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].id, "region-1");
      assert.strictEqual(regions[0].display_name, "US West 2");
      assert.strictEqual(regions[0].cloud, "aws");
      assert.strictEqual(regions[0].region_name, "us-west-2");
      assert.strictEqual(regions[0].http_endpoint, "https://flink.us-west-2.aws.confluent.cloud");
      assert.strictEqual(
        regions[0].private_http_endpoint,
        "https://private-flink.us-west-2.aws.confluent.cloud",
      );
    });

    /** Make fake region data for testing. */
    function makeFakeRegionData(count: number): CCloudFlinkRegionData[] {
      const regions: CCloudFlinkRegionData[] = [];

      for (let i = 0; i < count; i++) {
        regions.push({
          id: `region-${i}`,
          api_version: "fcpm/v2",
          kind: "Region",
          metadata: {
            self: `https://api.confluent.cloud/fcpm/v2/regions/region-${i}`,
          },
          display_name: `Region ${i}`,
          cloud: i % 2 === 0 ? "aws" : "azure",
          region_name: `region-${i}`,
          http_endpoint: `https://flink.region-${i}.confluent.cloud`,
        });
      }

      return regions;
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

  describe("executeBackgroundFlinkStatement", () => {
    let mockDeps: StatementExecutionDeps;
    let submitFlinkStatementStub: sinon.SinonStub;
    let waitForStatementCompletionStub: sinon.SinonStub;
    let parseAllFlinkStatementResultsStub: sinon.SinonStub;
    let deleteStatementStub: sinon.SinonStub;

    interface TestResult {
      EXPR0: number;
    }

    beforeEach(() => {
      // Create stub implementations for the dependencies
      submitFlinkStatementStub = sandbox.stub();
      waitForStatementCompletionStub = sandbox.stub();
      parseAllFlinkStatementResultsStub = sandbox.stub();

      mockDeps = {
        submitFlinkStatement: submitFlinkStatementStub,
        waitForStatementCompletion: waitForStatementCompletionStub,
        parseAllFlinkStatementResults: parseAllFlinkStatementResultsStub,
      };

      sandbox.stub(loader, "getOrganization").resolves(TEST_CCLOUD_ORGANIZATION);
      deleteStatementStub = sandbox.stub(loader, "deleteFlinkStatement");
    });

    it("should throw if provided compute pool is for different cloud/region", async () => {
      const differentCloudComputePool = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        provider: "nonexistent",
        region: "us-central1",
      });

      await assert.rejects(
        loader.executeBackgroundFlinkStatement(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          { computePool: differentCloudComputePool },
          mockDeps,
        ),
        /is not in the same cloud/,
      );
    });

    it("should default to first compute pool if none provided then run successfully through", async () => {
      // Sanity check to ensure test setup is correct.
      assert.strictEqual(
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.flinkPools[0].id,
        TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      );

      const submittedStatement = { phase: Phase.PENDING } as FlinkStatement;
      submitFlinkStatementStub.resolves(submittedStatement);

      const completedStatement = { phase: Phase.COMPLETED } as FlinkStatement;
      waitForStatementCompletionStub.resolves(completedStatement);

      const parseResults: Array<TestResult> = [{ EXPR0: 1 }];
      parseAllFlinkStatementResultsStub.resolves(parseResults);

      const returnedResults = await loader.executeBackgroundFlinkStatement<TestResult>(
        "SELECT 1",
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        {},
        mockDeps,
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
      sinon.assert.calledOnce(deleteStatementStub);
      sinon.assert.calledWithExactly(deleteStatementStub, completedStatement);
    });

    it("should return results even if deletion fails", async () => {
      const submittedStatement = { phase: Phase.PENDING } as FlinkStatement;
      submitFlinkStatementStub.resolves(submittedStatement);

      const completedStatement = { phase: Phase.COMPLETED } as FlinkStatement;
      waitForStatementCompletionStub.resolves(completedStatement);

      const parseResults: Array<TestResult> = [{ EXPR0: 1 }];
      parseAllFlinkStatementResultsStub.resolves(parseResults);

      const deletionError = new Error("Simulated deletion failure");
      deleteStatementStub.rejects(deletionError);

      const returnedResults = await loader.executeBackgroundFlinkStatement<TestResult>(
        "SELECT 1",
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        {},
        mockDeps,
      );

      assert.deepStrictEqual(returnedResults, parseResults);

      sinon.assert.calledOnce(submitFlinkStatementStub);
      sinon.assert.calledOnce(waitForStatementCompletionStub);
      sinon.assert.calledOnce(parseAllFlinkStatementResultsStub);
      sinon.assert.calledOnce(deleteStatementStub);
      sinon.assert.calledWithExactly(deleteStatementStub, completedStatement);
    });

    it("should throw if statement does not complete successfully", async () => {
      const submittedStatement = { phase: Phase.PENDING } as FlinkStatement;
      submitFlinkStatementStub.resolves(submittedStatement);

      const failedStatement = createFlinkStatement({ phase: Phase.FAILED });
      waitForStatementCompletionStub.resolves(failedStatement);

      await assert.rejects(
        loader.executeBackgroundFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          {},
          mockDeps,
        ),
        /did not complete successfully/,
      );

      sinon.assert.calledOnce(waitForStatementCompletionStub);
      sinon.assert.calledOnce(submitFlinkStatementStub);
      sinon.assert.notCalled(parseAllFlinkStatementResultsStub);
      sinon.assert.notCalled(deleteStatementStub);
    });

    it("should override timeout if provided", async () => {
      const submittedStatement = createFlinkStatement({ phase: Phase.PENDING });
      submitFlinkStatementStub.resolves(submittedStatement);

      const completedStatement = createFlinkStatement({ phase: Phase.COMPLETED });
      waitForStatementCompletionStub.resolves(completedStatement);

      const parseResults: Array<TestResult> = [{ EXPR0: 1 }];
      parseAllFlinkStatementResultsStub.resolves(parseResults);

      const customTimeout = 10;

      await loader.executeBackgroundFlinkStatement<TestResult>(
        "SELECT 1",
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        { timeout: customTimeout },
        mockDeps,
      );
      sinon.assert.calledOnce(submitFlinkStatementStub);
      sinon.assert.calledOnce(waitForStatementCompletionStub);
      const waitCallArgs = waitForStatementCompletionStub.getCall(0).args;
      assert.strictEqual(waitCallArgs[1], customTimeout);
    });

    describe("concurrency handling", () => {
      beforeEach(() => {
        // Set up any submitted statement to complete successfully
        const submittedStatement = { phase: Phase.PENDING } as FlinkStatement;
        submitFlinkStatementStub.resolves(submittedStatement);

        const completedStatement = { phase: Phase.COMPLETED } as FlinkStatement;
        waitForStatementCompletionStub.resolves(completedStatement);

        const parseResults: Array<TestResult> = [{ EXPR0: 1 }];
        parseAllFlinkStatementResultsStub.resolves(parseResults);
      });

      it("should return same promise if called multiple times concurrently", async () => {
        const promise1 = loader.executeBackgroundFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          {},
          mockDeps,
        );
        const promise2 = loader.executeBackgroundFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          {},
          mockDeps,
        );

        await Promise.all([promise1, promise2]);

        // waitForStatementCompletionStub, parseAllFlinkStatementResultsStub should have only be called once
        // since both calls should share the same promise.
        sinon.assert.calledOnce(waitForStatementCompletionStub);
        sinon.assert.calledOnce(parseAllFlinkStatementResultsStub);
      });

      it("should issue separate calls if called with different statements concurrently", async () => {
        const promise1 = loader.executeBackgroundFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          {},
          mockDeps,
        );
        const promise2 = loader.executeBackgroundFlinkStatement<TestResult>(
          "SELECT 2",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          {},
          mockDeps,
        );

        await Promise.all([promise1, promise2]);

        // waitForStatementCompletionStub, parseAllFlinkStatementResultsStub should have been called twice
        // since both calls should have been independent (separate statements).
        sinon.assert.calledTwice(waitForStatementCompletionStub);
        sinon.assert.calledTwice(parseAllFlinkStatementResultsStub);
      });

      it("pending promise map should be cleared after successful completion", async () => {
        await loader.executeBackgroundFlinkStatement<TestResult>(
          "SELECT 1",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          {},
          mockDeps,
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
          await loader.executeBackgroundFlinkStatement<TestResult>(
            "SELECT 1",
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            {},
            mockDeps,
          );
        });

        assert.strictEqual(
          loader["backgroundStatementPromises"].size,
          0,
          "Expected pending promise map to be cleared",
        );
      });
    });

    for (const skipKind of SKIP_RESULTS_SQL_KINDS) {
      it(`should skip fetching results for sqlKind=${skipKind} statements`, async () => {
        const submittedStatement = createFlinkStatement({ phase: Phase.PENDING });
        submitFlinkStatementStub.resolves(submittedStatement);

        const completedStatement = createFlinkStatement({
          phase: Phase.COMPLETED,
          sqlKind: skipKind,
        });
        waitForStatementCompletionStub.resolves(completedStatement);

        const results = await loader.executeBackgroundFlinkStatement<TestResult>(
          "STATEMENT THAT HAS NO RESULTS",
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          {},
          mockDeps,
        );

        assert.deepStrictEqual(results, []);
        sinon.assert.calledOnce(submitFlinkStatementStub);
        sinon.assert.calledOnce(waitForStatementCompletionStub);
        sinon.assert.notCalled(parseAllFlinkStatementResultsStub);
        sinon.assert.calledOnce(deleteStatementStub);
      });
    }
  });

  describe("deleteFlinkStatement", () => {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let deleteStatementStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager to return a data plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub the CCloudDataPlaneProxy.prototype.deleteStatement method
      deleteStatementStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "deleteStatement");
    });

    it("should successfully delete a statement", async () => {
      deleteStatementStub.resolves();

      const statementToDelete = createFlinkStatement();
      await loader.deleteFlinkStatement(statementToDelete);

      sinon.assert.calledOnceWithExactly(deleteStatementStub, statementToDelete.name);
    });

    it("should raise if deletion fails", async () => {
      const error = new Error("API request failed");
      deleteStatementStub.rejects(error);

      const statementToDelete = createFlinkStatement();
      await assert.rejects(async () => {
        await loader.deleteFlinkStatement(statementToDelete);
      }, error);

      sinon.assert.calledOnceWithExactly(deleteStatementStub, statementToDelete.name);
    });
  });

  describe("stopFlinkStatement", () => {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let stopStatementStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub TokenManager to return a data plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub the CCloudDataPlaneProxy.prototype.stopStatement method
      stopStatementStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "stopStatement");
    });

    it("should successfully stop a statement", async () => {
      stopStatementStub.resolves();

      const statement = createFlinkStatement({ phase: Phase.RUNNING });
      await loader.stopFlinkStatement(statement);

      sinon.assert.calledOnceWithExactly(stopStatementStub, statement.name);
    });

    it("should propagate API errors when stop fails", async () => {
      const apiError = new Error("Stop failed");
      stopStatementStub.rejects(apiError);

      const statement = createFlinkStatement({ phase: Phase.RUNNING });
      await assert.rejects(async () => {
        await loader.stopFlinkStatement(statement);
      }, apiError);

      sinon.assert.calledOnceWithExactly(stopStatementStub, statement.name);
    });
  });
  describe("getFlinkWorkspace", () => {
    let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;
    let getWorkspaceStub: sinon.SinonStub;

    const testParams: FlinkWorkspaceParams = {
      environmentId: "env-12345",
      organizationId: "org-67890",
      workspaceName: "test-workspace",
      provider: "aws",
      region: "us-west-2",
    };

    beforeEach(() => {
      // Stub TokenManager to return a data plane token
      tokenManagerStub = sandbox.createStubInstance(TokenManager);
      tokenManagerStub.getDataPlaneToken.resolves("test-data-plane-token");
      sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);

      // Stub the CCloudDataPlaneProxy.prototype.getWorkspace method
      getWorkspaceStub = sandbox.stub(CCloudDataPlaneProxy.prototype, "getWorkspace");
    });

    it("should return the workspace when fetch succeeds", async () => {
      const mockWorkspace = {
        api_version: "ws/v1",
        kind: "Workspace",
        name: "test-workspace",
        organization_id: "org-67890",
        environment_id: "env-12345",
        metadata: {
          self: "https://flink.us-west-2.aws.confluent.cloud/ws/v1/workspaces/test-workspace",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        spec: {
          name: "Test Workspace",
          compute_pool: "lfcp-12345",
          blocks: [{ content: "SELECT 1" }],
        },
        status: {
          phase: "READY",
        },
      };
      getWorkspaceStub.resolves(mockWorkspace);

      const result = await loader.getFlinkWorkspace(testParams);

      assert.ok(result, "Expected workspace result");
      assert.strictEqual(result.name, "test-workspace");
      assert.strictEqual(result.organization_id, "org-67890");
      assert.strictEqual(result.environment_id, "env-12345");
      sinon.assert.calledOnceWithExactly(getWorkspaceStub, testParams.workspaceName);
    });

    it("should return null when not authenticated", async () => {
      tokenManagerStub.getDataPlaneToken.resolves(null);

      const result = await loader.getFlinkWorkspace(testParams);

      assert.strictEqual(result, null);
      sinon.assert.notCalled(getWorkspaceStub);
    });

    it("should return null when workspace API call fails", async () => {
      const apiError = new Error("Workspace not found");
      getWorkspaceStub.rejects(apiError);

      const result = await loader.getFlinkWorkspace(testParams);

      assert.strictEqual(result, null);
      sinon.assert.calledOnce(getWorkspaceStub);
    });

    it("should correctly convert workspace spec with blocks to statements", async () => {
      const mockWorkspace = {
        name: "test-workspace",
        organization_id: "org-67890",
        environment_id: "env-12345",
        spec: {
          name: "My Workspace",
          compute_pool: "lfcp-abc123",
          blocks: [{ content: "SELECT 1" }, { content: "SELECT 2" }],
        },
      };
      getWorkspaceStub.resolves(mockWorkspace);

      const result = await loader.getFlinkWorkspace(testParams);

      assert.ok(result, "Expected workspace result");
      assert.strictEqual(result.spec.display_name, "My Workspace");
      assert.strictEqual(result.spec.compute_pool, "lfcp-abc123");
      // The spec includes a runtime-added `statements` property (not in generated types)
      const spec = result.spec as { statements?: { sql: string }[] };
      assert.strictEqual(spec.statements?.length, 2);
      assert.strictEqual(spec.statements?.[0].sql, "SELECT 1");
      assert.strictEqual(spec.statements?.[1].sql, "SELECT 2");
    });

    it("should handle workspace with empty spec", async () => {
      const mockWorkspace = {
        name: "test-workspace",
        organization_id: "org-67890",
        environment_id: "env-12345",
        metadata: {},
        spec: {},
      };
      getWorkspaceStub.resolves(mockWorkspace);

      const result = await loader.getFlinkWorkspace(testParams);

      assert.ok(result, "Expected workspace result");
      assert.strictEqual(result.name, "test-workspace");
      // The spec includes a runtime-added `statements` property (not in generated types)
      const spec = result.spec as { statements?: { sql: string }[] };
      assert.deepStrictEqual(spec.statements, []);
    });
  });
});
