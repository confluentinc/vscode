import * as assert from "assert";
import * as sinon from "sinon";
import { CodeLens, Position, Range, TextDocument, Uri } from "vscode";
import { eventEmitterStubs, StubbedEventEmitters } from "../../tests/stubs/emitters";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import * as ccloud from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager, ResourceManager } from "../storage/resourceManager";
import { UriMetadata } from "../storage/types";
import {
  CatalogDatabase,
  FlinkSqlCodelensProvider,
  getCatalogDatabaseFromMetadata,
  getComputePoolFromMetadata,
  getDefaultCatalogDatabase,
} from "./flinkSqlProvider";

const testUri = Uri.parse("file:///test/file.sql");

describe("codelens/flinkSqlProvider.ts", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("FlinkSqlCodelensProvider", () => {
    let provider: FlinkSqlCodelensProvider;
    let resourceManagerStub: sinon.SinonStubbedInstance<ResourceManager>;
    let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let hasCCloudAuthSessionStub: sinon.SinonStub;

    // NOTE: setting up fake TextDocuments is tricky since we can't create them directly, so we're
    // only populating the fields needed for the test and associated codebase logic, then using the
    // `as unknown as TextDocument` pattern to appease TypeScript
    const fakeDocument: TextDocument = { uri: testUri } as unknown as TextDocument;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();

      // reset any stored metadata
      await getResourceManager().deleteAllUriMetadata();
      resourceManagerStub = sandbox.createStubInstance(ResourceManager);
      sandbox.stub(ResourceManager, "getInstance").returns(resourceManagerStub);

      ccloudLoaderStub = sandbox.createStubInstance(CCloudResourceLoader);
      sandbox.stub(CCloudResourceLoader, "getInstance").returns(ccloudLoaderStub);
      ccloudLoaderStub.getOrganization.resolves(TEST_CCLOUD_ORGANIZATION);
      ccloudLoaderStub.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);

      hasCCloudAuthSessionStub = sandbox.stub(ccloud, "hasCCloudAuthSession").returns(true);

      provider = FlinkSqlCodelensProvider.getInstance();
    });

    afterEach(async () => {
      provider.dispose();
      FlinkSqlCodelensProvider["instance"] = null;
      sandbox.restore();
      // clean up any stored metadata
      await getResourceManager().deleteAllUriMetadata();
    });

    describe("setEventListeners() event emitter wiring tests", () => {
      let emitterStubs: StubbedEventEmitters;

      beforeEach(() => {
        // Stub all event emitters in the emitters module
        emitterStubs = eventEmitterStubs(sandbox);
      });

      // Define test cases as corresponding pairs of
      // [event emitter name, view provider handler method name]
      const handlerEmitterPairs: Array<
        [keyof typeof emitterStubs, keyof FlinkSqlCodelensProvider]
      > = [
        ["ccloudConnected", "ccloudConnectedHandler"],
        ["uriMetadataSet", "uriMetadataSetHandler"],
      ];

      it("setEventListeners() should return the expected number of listeners", () => {
        const listeners = provider["setEventListeners"]();
        assert.strictEqual(listeners.length, handlerEmitterPairs.length);
      });

      handlerEmitterPairs.forEach(([emitterName, handlerMethodName]) => {
        it(`should register ${handlerMethodName} with ${emitterName} emitter`, () => {
          // Create stub for the handler method
          const handlerStub = sandbox.stub(provider, handlerMethodName);

          // Re-invoke setEventListeners() to capture emitter .event() stub calls
          provider["setEventListeners"]();

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

    describe("event handlers", () => {
      let onDidChangeCodeLensesFireStub: sinon.SinonStub;

      beforeEach(() => {
        // Stub the onDidChangeCodeLenses event emitter fire method.
        onDidChangeCodeLensesFireStub = sandbox.stub(provider["_onDidChangeCodeLenses"], "fire");
      });

      for (const connected of [true, false]) {
        it("ccloudConnectedHandler() should call onDidChangeCodeLenses.fire()", () => {
          provider.ccloudConnectedHandler(connected);

          sinon.assert.calledOnce(onDidChangeCodeLensesFireStub);
        });
      }

      it("uriMetadataSetHandler() should call onDidChangeCodeLenses.fire()", () => {
        provider.uriMetadataSetHandler(); // disregards the Uri of the document, so no need to pass it.
        sinon.assert.calledOnce(onDidChangeCodeLensesFireStub);
      });
    });

    it("should create only one instance of FlinkSqlCodelensProvider", () => {
      const provider2 = FlinkSqlCodelensProvider.getInstance();

      try {
        assert.strictEqual(provider, provider2);
      } finally {
        provider2.dispose();
      }
    });

    it("should create codelenses at the top of the document", async () => {
      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      const expectedRange = new Range(new Position(0, 0), new Position(0, 0));
      for (const lens of codeLenses) {
        assert.deepStrictEqual(lens.range, expectedRange);
      }
    });

    it("should provide sign-in codelens when not signed in to CCloud", async () => {
      // simulate no CCloud auth session
      hasCCloudAuthSessionStub.returns(false);

      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      assert.strictEqual(codeLenses.length, 1);

      assert.ok(codeLenses[0].command);
      assert.strictEqual(codeLenses[0].command?.command, "confluent.connections.ccloud.signIn");
      assert.strictEqual(codeLenses[0].command?.title, "Sign in to Confluent Cloud");
    });

    for (const metadataPoolId of [undefined, "old-or-invalid-pool-id"]) {
      it(`should provide 'Set Compute Pool' codelens when no pool is found matching stored metadata (${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}=${metadataPoolId})`, async () => {
        resourceManagerStub.getUriMetadata.resolves({
          // undefined or something that won't match a valid pool
          [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: metadataPoolId,
        });
        const envWithoutPool: CCloudEnvironment = new CCloudEnvironment({
          ...TEST_CCLOUD_ENVIRONMENT,
          flinkComputePools: [],
        });
        ccloudLoaderStub.getEnvironments.resolves([envWithoutPool]);

        const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

        assert.strictEqual(codeLenses.length, 3);

        const poolLens = codeLenses[0];
        const dbLens = codeLenses[1];
        const resetLens = codeLenses[2];

        assert.strictEqual(
          dbLens.command?.command,
          "confluent.document.flinksql.setCCloudDatabase",
        );
        assert.strictEqual(dbLens.command?.title, "Set Catalog & Database");
        assert.deepStrictEqual(dbLens.command?.arguments, [fakeDocument.uri, undefined]);

        assert.strictEqual(
          poolLens.command?.command,
          "confluent.document.flinksql.setCCloudComputePool",
        );
        assert.strictEqual(poolLens.command?.title, "Set Compute Pool");
        assert.deepStrictEqual(poolLens.command?.arguments, [fakeDocument.uri, undefined]);

        assert.strictEqual(
          resetLens.command?.command,
          "confluent.document.flinksql.resetCCloudMetadata",
        );
        assert.strictEqual(resetLens.command?.title, "Clear Settings");
        assert.deepStrictEqual(resetLens.command?.arguments, [fakeDocument.uri]);
      });
    }

    for (const metadataDatabaseId of [undefined, "old-or-invalid-db-id"]) {
      it(`should provide 'Set Catalog & Database' codelens when no database is found matching stored metadata (${UriMetadataKeys.FLINK_DATABASE_ID}=${metadataDatabaseId})`, async () => {
        const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
        // simulate stored compute pool metadata
        resourceManagerStub.getUriMetadata.resolves({
          [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
          // undefined or something that won't match a valid catalog+db
          [UriMetadataKeys.FLINK_DATABASE_ID]: metadataDatabaseId,
        });
        const envWithoutPool: CCloudEnvironment = new CCloudEnvironment({
          ...TEST_CCLOUD_ENVIRONMENT,
          flinkComputePools: [pool],
        });
        ccloudLoaderStub.getEnvironments.resolves([envWithoutPool]);

        const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

        assert.strictEqual(codeLenses.length, 3);

        const poolLens = codeLenses[0];
        const dbLens = codeLenses[1];
        const resetLens = codeLenses[2];

        assert.strictEqual(
          dbLens.command?.command,
          "confluent.document.flinksql.setCCloudDatabase",
        );
        assert.strictEqual(dbLens.command?.title, "Set Catalog & Database");
        assert.deepStrictEqual(dbLens.command?.arguments, [
          fakeDocument.uri,
          TEST_CCLOUD_FLINK_COMPUTE_POOL,
        ]);

        assert.strictEqual(
          poolLens.command?.command,
          "confluent.document.flinksql.setCCloudComputePool",
        );
        assert.strictEqual(poolLens.command?.title, pool.name);
        assert.deepStrictEqual(poolLens.command?.arguments, [fakeDocument.uri, undefined]);

        assert.strictEqual(
          resetLens.command?.command,
          "confluent.document.flinksql.resetCCloudMetadata",
        );
        assert.strictEqual(resetLens.command?.title, "Clear Settings");
        assert.deepStrictEqual(resetLens.command?.arguments, [fakeDocument.uri]);
      });
    }

    it("should provide 'Submit Statement' codelens when a compute pool and catalog+database are set", async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      const database: CCloudKafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
      // simulate stored compute pool + database metadata
      resourceManagerStub.getUriMetadata.resolves({
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
        [UriMetadataKeys.FLINK_CATALOG_ID]: TEST_CCLOUD_ENVIRONMENT.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
        [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: database.name,
      });
      const envWithPool: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [database],
        flinkComputePools: [pool],
      });
      ccloudLoaderStub.getEnvironments.resolves([envWithPool]);

      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      assert.strictEqual(codeLenses.length, 4);

      const submitLens = codeLenses[0];
      const poolLens = codeLenses[1];
      const dbLens = codeLenses[2];
      const resetLens = codeLenses[3];

      assert.strictEqual(submitLens.command?.command, "confluent.statements.create");
      assert.strictEqual(submitLens.command?.title, "▶️ Submit Statement");
      assert.deepStrictEqual(submitLens.command?.arguments, [fakeDocument.uri, pool, database]);

      assert.strictEqual(dbLens.command?.command, "confluent.document.flinksql.setCCloudDatabase");
      assert.strictEqual(
        dbLens.command?.title,
        `${TEST_CCLOUD_ENVIRONMENT.name}, ${database.name}`,
      );
      assert.deepStrictEqual(dbLens.command?.arguments, [fakeDocument.uri, pool]);

      assert.strictEqual(
        poolLens.command?.command,
        "confluent.document.flinksql.setCCloudComputePool",
      );
      assert.strictEqual(poolLens.command?.title, pool.name);
      assert.deepStrictEqual(poolLens.command?.arguments, [fakeDocument.uri, database]);

      assert.strictEqual(
        resetLens.command?.command,
        "confluent.document.flinksql.resetCCloudMetadata",
      );
      assert.strictEqual(resetLens.command?.title, "Clear Settings");
      assert.deepStrictEqual(resetLens.command?.arguments, [fakeDocument.uri]);
    });
  });

  describe("getComputePoolFromMetadata()", () => {
    let stubbedConfigs: StubbedWorkspaceConfiguration;

    const testFlinkEnv: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    });

    beforeEach(() => {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    });

    it(`should return undefined if no "${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}" metadata is found and no default "${FLINK_CONFIG_COMPUTE_POOL.id}" value is set`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, undefined);
      const metadata: UriMetadata = {};
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const pool: CCloudFlinkComputePool | undefined = await getComputePoolFromMetadata(
        metadata,
        envs,
      );

      assert.strictEqual(pool, undefined);
    });

    it(`should return the default "${FLINK_CONFIG_COMPUTE_POOL.id}" value if "${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}" metadata is undefined`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
      const metadata: UriMetadata = {};
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const pool: CCloudFlinkComputePool | undefined = await getComputePoolFromMetadata(
        metadata,
        envs,
      );

      assert.ok(pool instanceof CCloudFlinkComputePool);
      assert.strictEqual(pool.id, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
    });

    it(`should return undefined if "${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}" is 'null' as a result of clearing metadata, even if default "${FLINK_CONFIG_COMPUTE_POOL.id}" is set`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: null,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const pool: CCloudFlinkComputePool | undefined = await getComputePoolFromMetadata(
        metadata,
        envs,
      );

      assert.strictEqual(pool, undefined);
    });

    it(`should return the stored value if "${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}" metadata is found`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, undefined);
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const pool: CCloudFlinkComputePool | undefined = await getComputePoolFromMetadata(
        metadata,
        envs,
      );

      assert.ok(pool instanceof CCloudFlinkComputePool);
      assert.strictEqual(pool.id, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
    });

    it(`should favor stored "${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}" metadata over default "${FLINK_CONFIG_COMPUTE_POOL.id}" value`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, "some-other-pool-id");
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const pool: CCloudFlinkComputePool | undefined = await getComputePoolFromMetadata(
        metadata,
        envs,
      );

      assert.ok(pool instanceof CCloudFlinkComputePool);
      assert.strictEqual(pool.id, TEST_CCLOUD_FLINK_COMPUTE_POOL.id);
    });

    it(`should return undefined if the stored "${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}" metadata doesn't match any pools`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, undefined);
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "some-other-pool-id",
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const pool: CCloudFlinkComputePool | undefined = await getComputePoolFromMetadata(
        metadata,
        envs,
      );

      assert.strictEqual(pool, undefined);
    });
  });

  describe("getCatalogDatabaseFromMetadata()", () => {
    let stubbedConfigs: StubbedWorkspaceConfiguration;

    const testFlinkEnv: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });

    beforeEach(() => {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    });

    it(`should return no catalog/database if no "${UriMetadataKeys.FLINK_DATABASE_ID}" metadata is found and no default "${FLINK_CONFIG_DATABASE.id}" value is set`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, undefined);
      const metadata: UriMetadata = {};
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, undefined);
      assert.strictEqual(catalogDb.database, undefined);
    });

    it(`should return the default "${FLINK_CONFIG_DATABASE.id}" value if "${UriMetadataKeys.FLINK_DATABASE_ID}" metadata is undefined`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, TEST_CCLOUD_KAFKA_CLUSTER.id);
      const metadata: UriMetadata = {};
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, testFlinkEnv);
      assert.ok(catalogDb.database instanceof CCloudKafkaCluster);
      assert.strictEqual(catalogDb.database.id, TEST_CCLOUD_KAFKA_CLUSTER.id);
    });

    it(`should return undefined if "${UriMetadataKeys.FLINK_DATABASE_NAME}" is 'null' as a result of clearing metadata, even if default "${FLINK_CONFIG_DATABASE.id}" is set`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, TEST_CCLOUD_KAFKA_CLUSTER.id);
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_DATABASE_NAME]: null,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, undefined);
      assert.strictEqual(catalogDb.database, undefined);
    });

    it(`should return database from "${UriMetadataKeys.FLINK_DATABASE_ID}" metadata if found`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, undefined);
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_KAFKA_CLUSTER.name,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, testFlinkEnv);
      assert.ok(catalogDb.database instanceof CCloudKafkaCluster);
      assert.strictEqual(catalogDb.database.id, TEST_CCLOUD_KAFKA_CLUSTER.id);
    });

    it(`should favor stored "${UriMetadataKeys.FLINK_DATABASE_ID}" metadata over default "${FLINK_CONFIG_DATABASE.id}" value`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, "some-other-database-id");
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_KAFKA_CLUSTER.name,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, testFlinkEnv);
      assert.ok(catalogDb.database instanceof CCloudKafkaCluster);
      assert.strictEqual(catalogDb.database.id, TEST_CCLOUD_KAFKA_CLUSTER.id);
    });

    it(`should return no catalog/database if the stored "${UriMetadataKeys.FLINK_DATABASE_ID}" metadata doesn't match any database`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, undefined);
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_DATABASE_NAME]: "non-existent-database-name",
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, undefined);
      assert.strictEqual(catalogDb.database, undefined);
    });

    it("should return database when compute pool is provided and database provider/region matches", async () => {
      // provider/region match TEST_CCLOUD_KAFKA_CLUSTER by default
      const matchingComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, undefined);
      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_KAFKA_CLUSTER.name,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv];
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(
        metadata,
        envs,
        matchingComputePool,
      );

      assert.strictEqual(catalogDb.catalog, testFlinkEnv);
      assert.ok(catalogDb.database instanceof CCloudKafkaCluster);
      assert.strictEqual(catalogDb.database.id, TEST_CCLOUD_KAFKA_CLUSTER.id);
    });

    it("should select the correct database even if there are duplicate database names across catalogs", async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      const catalogName = "env_0";
      const databaseName = "cluster_0";

      // two Kafka clusters/databases, both of which share a common name/ID but are in different
      // catalogs/environments and have different provider/region values
      const correctDatabase: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
      });
      const incorrectDatabase: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: "other-provider",
        region: "other-region",
      });
      // two environments/catalogs, both of which include a Kafka cluster with the name we're trying
      // to match against a statement's database ID/name
      const correctCatalog: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env1" as EnvironmentId,
        name: catalogName,
        flinkComputePools: [pool],
        kafkaClusters: [correctDatabase],
      });
      const incorrectCatalog: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env2" as EnvironmentId,
        name: "Other Catalog",
        flinkComputePools: [pool],
        kafkaClusters: [incorrectDatabase],
      });
      // make sure the incorrect one shows up first in the list to prove that we're not just taking
      // the first match we find
      const envs = [incorrectCatalog, correctCatalog];
      const metadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
        [UriMetadataKeys.FLINK_CATALOG_ID]: correctCatalog.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: catalogName,
        [UriMetadataKeys.FLINK_DATABASE_ID]: correctDatabase.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: databaseName,
      };

      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.deepStrictEqual(catalogDb.catalog, correctCatalog);
      assert.deepStrictEqual(catalogDb.database, correctDatabase);
    });

    it("should use provider/region matching when metadata has names but no IDs", async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      const catalogName = "shared-env-name";
      const databaseName = "shared-cluster-name";

      // two Kafka clusters/databases with same names but different provider/region
      const correctDatabase: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: pool.provider,
        region: pool.region,
        environmentId: "env1" as EnvironmentId,
      });
      const incorrectDatabase: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: "different-provider",
        region: "different-region",
        environmentId: "env2" as EnvironmentId,
      });

      // two environments/catalogs with same names
      const correctCatalog: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: correctDatabase.environmentId,
        name: catalogName,
        flinkComputePools: [pool],
        kafkaClusters: [correctDatabase],
      });
      const incorrectCatalog: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: incorrectDatabase.environmentId,
        name: catalogName,
        flinkComputePools: [pool],
        kafkaClusters: [incorrectDatabase],
      });

      const envs = [incorrectCatalog, correctCatalog];
      // metadata with names but no IDs - should fall back to provider/region matching
      const metadata = {
        [UriMetadataKeys.FLINK_CATALOG_NAME]: catalogName,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: databaseName,
        // no FLINK_CATALOG_ID or FLINK_DATABASE_ID
      };

      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs, pool);

      assert.deepStrictEqual(catalogDb.catalog, correctCatalog);
      assert.deepStrictEqual(catalogDb.database, correctDatabase);
    });

    it("should return empty result when metadata has names but no IDs and no compute pool is provided", async () => {
      const catalogName = "shared-env-name";
      const databaseName = "shared-cluster-name";

      // two environments/catalogs with same names
      const catalog1: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env1" as EnvironmentId,
        name: catalogName,
        kafkaClusters: [
          CCloudKafkaCluster.create({
            ...TEST_CCLOUD_KAFKA_CLUSTER,
            name: databaseName,
          }),
        ],
      });
      const catalog2: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env2" as EnvironmentId,
        name: catalogName,
        kafkaClusters: [
          CCloudKafkaCluster.create({
            ...TEST_CCLOUD_KAFKA_CLUSTER,
            name: databaseName,
          }),
        ],
      });

      const envs = [catalog1, catalog2];
      const metadata = {
        [UriMetadataKeys.FLINK_CATALOG_NAME]: catalogName,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: databaseName,
        // no IDs provided
      };

      // no compute pool provided - can't resolve ambiguity
      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, undefined);
      assert.strictEqual(catalogDb.database, undefined);
    });

    it("should return empty result when catalog/database names are duplicated, IDs don't match, and no compute pool is provided", async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, undefined);

      // unhappy scenario where resource names match but IDs don't, and no compute pool is
      // provided to help narrow down the results
      const duplicateEnv: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env-duplicate" as EnvironmentId,
        name: TEST_CCLOUD_ENVIRONMENT.name,
        kafkaClusters: [
          CCloudKafkaCluster.create({
            ...TEST_CCLOUD_KAFKA_CLUSTER,
            id: "lkc-duplicate" as any,
            name: TEST_CCLOUD_KAFKA_CLUSTER.name,
          }),
        ],
      });

      const metadata: UriMetadata = {
        [UriMetadataKeys.FLINK_CATALOG_ID]: "non-existent-catalog-id",
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
        [UriMetadataKeys.FLINK_DATABASE_ID]: "non-existent-database-id",
        [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_KAFKA_CLUSTER.name,
      };
      const envs: CCloudEnvironment[] = [testFlinkEnv, duplicateEnv];

      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs);

      assert.strictEqual(catalogDb.catalog, undefined);
      assert.strictEqual(catalogDb.database, undefined);
    });

    it("should return empty result when provider/region matching finds no matches", async () => {
      const pool: CCloudFlinkComputePool = new CCloudFlinkComputePool({
        ...TEST_CCLOUD_FLINK_COMPUTE_POOL,
        provider: "non-matching-provider",
        region: "non-matching-region",
      });

      const catalogName = "shared-env-name";
      const databaseName = "shared-cluster-name";

      // databases that don't match the compute pool's provider/region
      const database1: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: "provider-1",
        region: "region-1",
      });
      const database2: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: "provider-2",
        region: "region-2",
      });

      const catalog1: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env1" as EnvironmentId,
        name: catalogName,
        kafkaClusters: [database1],
      });
      const catalog2: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env2" as EnvironmentId,
        name: catalogName,
        kafkaClusters: [database2],
      });

      const envs = [catalog1, catalog2];
      const metadata = {
        [UriMetadataKeys.FLINK_CATALOG_NAME]: catalogName,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: databaseName,
      };

      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs, pool);

      assert.strictEqual(catalogDb.catalog, undefined);
      assert.strictEqual(catalogDb.database, undefined);
    });

    it("should return empty result when provider/region matching finds multiple matches", async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      const catalogName = "shared-env-name";
      const databaseName = "shared-cluster-name";

      // multiple databases that match the compute pool's provider/region
      const database1: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: pool.provider,
        region: pool.region,
      });
      const database2: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: pool.provider,
        region: pool.region,
      });

      const catalog1: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env1" as EnvironmentId,
        name: catalogName,
        kafkaClusters: [database1],
      });
      const catalog2: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        id: "env2" as EnvironmentId,
        name: catalogName,
        kafkaClusters: [database2],
      });

      const envs = [catalog1, catalog2];
      const metadata = {
        [UriMetadataKeys.FLINK_CATALOG_NAME]: catalogName,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: databaseName,
      };

      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs, pool);

      // can't narrow down to single match, so should return empty
      assert.strictEqual(catalogDb.catalog, undefined);
      assert.strictEqual(catalogDb.database, undefined);
    });

    it("should fallback to provider/region matching when IDs are provided but don't match", async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      const catalogName = "test-env";
      const databaseName = "test-cluster";

      const correctDatabase: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        name: databaseName,
        provider: pool.provider,
        region: pool.region,
      });
      const correctCatalog: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        name: catalogName,
        kafkaClusters: [correctDatabase],
      });

      const envs = [correctCatalog];
      const metadata = {
        [UriMetadataKeys.FLINK_CATALOG_ID]: "non-existent-catalog-id", // wrong ID
        [UriMetadataKeys.FLINK_CATALOG_NAME]: catalogName,
        [UriMetadataKeys.FLINK_DATABASE_ID]: "non-existent-database-id", // wrong ID
        [UriMetadataKeys.FLINK_DATABASE_NAME]: databaseName,
      };

      const catalogDb: CatalogDatabase = await getCatalogDatabaseFromMetadata(metadata, envs, pool);

      // should fallback to provider/region matching and succeed
      assert.deepStrictEqual(catalogDb.catalog, correctCatalog);
      assert.deepStrictEqual(catalogDb.database, correctDatabase);
    });
  });

  describe("getDefaultCatalogDatabase()", () => {
    let stubbedConfigs: StubbedWorkspaceConfiguration;

    const testFlinkEnv: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    });

    beforeEach(() => {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    });

    it("should return an empty result when no environments are provided", async () => {
      const result = await getDefaultCatalogDatabase([]);

      assert.strictEqual(result.catalog, undefined);
      assert.strictEqual(result.database, undefined);
    });

    it(`should return an empty result when "${FLINK_CONFIG_DATABASE.id}" is not set`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, undefined);
      const envs = [testFlinkEnv];

      const result = await getDefaultCatalogDatabase(envs);

      assert.strictEqual(result.catalog, undefined);
      assert.strictEqual(result.database, undefined);
    });

    it(`should return a catalog and database when "${FLINK_CONFIG_DATABASE.id}" is set and matches an existing database (Kafka cluster)`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, TEST_CCLOUD_KAFKA_CLUSTER.id);
      const testEnv = new CCloudEnvironment({
        ...testFlinkEnv,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      });
      const envs = [testEnv];

      const result = await getDefaultCatalogDatabase(envs);

      assert.strictEqual(result.catalog, testEnv);
      assert.strictEqual(result.database?.id, TEST_CCLOUD_KAFKA_CLUSTER.id);
    });

    it(`should return an empty result when "${FLINK_CONFIG_DATABASE.id}" is set but doesn't match any databases`, async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_DATABASE, "non-existent-id");
      const envs = [testFlinkEnv];

      const result = await getDefaultCatalogDatabase(envs);

      assert.strictEqual(result.catalog, undefined);
      assert.strictEqual(result.database, undefined);
    });
  });
});
