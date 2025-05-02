import * as assert from "assert";
import * as sinon from "sinon";
import { CodeLens, Position, Range, TextDocument, Uri } from "vscode";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import * as ccloud from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { FlinkSqlCodelensProvider } from "./flinkSqlProvider";

describe("codelens/flinkSqlProvider.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let resourceManagerStub: sinon.SinonStubbedInstance<ResourceManager>;
  let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let hasCCloudAuthSessionStub: sinon.SinonStub;

  // NOTE: setting up fake TextDocuments is tricky since we can't create them directly, so we're
  // only populating the fields needed for the test and associated codebase logic, then using the
  // `as unknown as TextDocument` pattern to appease TypeScript
  const fakeDocument: TextDocument = {
    uri: Uri.parse("file:///test/file.sql"),
  } as unknown as TextDocument;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    resourceManagerStub = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(resourceManagerStub);

    ccloudLoaderStub = sandbox.createStubInstance(CCloudResourceLoader);
    sandbox.stub(CCloudResourceLoader, "getInstance").returns(ccloudLoaderStub);
    ccloudLoaderStub.getOrganization.resolves(TEST_CCLOUD_ORGANIZATION);
    ccloudLoaderStub.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);

    hasCCloudAuthSessionStub = sandbox.stub(ccloud, "hasCCloudAuthSession").returns(true);

    FlinkSqlCodelensProvider["instance"] = null;
  });

  afterEach(() => {
    FlinkSqlCodelensProvider["instance"] = null;
    sandbox.restore();
  });

  it("should create only one instance of FlinkSqlCodelensProvider", () => {
    const instance1 = FlinkSqlCodelensProvider.getInstance();
    const instance2 = FlinkSqlCodelensProvider.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  it("should register event listeners to .disposables", () => {
    const provider = FlinkSqlCodelensProvider.getInstance();

    // TODO: figure out why stubbing the event emitters' .event methods doesn't work here
    // when checking call counts after the provider is created
    assert.strictEqual(provider.disposables.length, 2);
  });

  it("should provide sign-in codelens when not signed in to CCloud", async () => {
    // simulate no CCloud auth session
    hasCCloudAuthSessionStub.returns(false);

    const provider = FlinkSqlCodelensProvider.getInstance();
    const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

    assert.strictEqual(codeLenses.length, 1);
    assert.ok(codeLenses[0].command);
    assert.strictEqual(codeLenses[0].command?.command, "confluent.connections.ccloud.signIn");
    assert.strictEqual(codeLenses[0].command?.title, "Sign in to Confluent Cloud");
  });

  for (const metadataPoolId of [undefined, "old-or-invalid-pool-id"]) {
    it(`should provide 'Set Compute Pool' codelens when no pool is found matching stored metadata (${UriMetadataKeys.FLINK_COMPUTE_POOL_ID}=${metadataPoolId})`, async () => {
      // simulate stored env metadata
      const envWithoutPool: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });
      ccloudLoaderStub.getEnvironments.resolves([envWithoutPool]);
      resourceManagerStub.getUriMetadata.resolves({
        // undefined or something that won't match a valid pool
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: metadataPoolId,
      });

      const provider = FlinkSqlCodelensProvider.getInstance();
      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      assert.strictEqual(codeLenses.length, 2);

      assert.strictEqual(
        codeLenses[0].command?.command,
        "confluent.document.flinksql.setCCloudCatalogDatabase",
      );
      assert.strictEqual(codeLenses[0].command?.title, "Set Catalog & Database");
      assert.deepStrictEqual(codeLenses[0].command?.arguments, [fakeDocument.uri]);

      assert.strictEqual(
        codeLenses[1].command?.command,
        "confluent.document.flinksql.setCCloudComputePool",
      );
      assert.strictEqual(codeLenses[1].command?.title, "Set Compute Pool");
      assert.deepStrictEqual(codeLenses[1].command?.arguments, [fakeDocument.uri]);
    });
  }

  for (const metadataDatabaseId of [undefined, "old-or-invalid-db-id"]) {
    it(`should provide 'Set Catalog & Database' codelens when no database is found matching stored metadata (${UriMetadataKeys.FLINK_DATABASE_ID}=${metadataDatabaseId})`, async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      // simulate stored env metadata
      const envWithoutPool: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [pool],
      });
      ccloudLoaderStub.getEnvironments.resolves([envWithoutPool]);
      resourceManagerStub.getUriMetadata.resolves({
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
        // undefined or something that won't match a valid catalog+db
        [UriMetadataKeys.FLINK_DATABASE_ID]: metadataDatabaseId,
      });

      const provider = FlinkSqlCodelensProvider.getInstance();
      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      assert.strictEqual(codeLenses.length, 3);

      assert.strictEqual(
        codeLenses[0].command?.command,
        "confluent.document.flinksql.setCCloudCatalogDatabase",
      );
      assert.strictEqual(codeLenses[0].command?.title, "Set Catalog & Database");
      assert.deepStrictEqual(codeLenses[0].command?.arguments, [fakeDocument.uri]);

      assert.strictEqual(
        codeLenses[1].command?.command,
        "confluent.document.flinksql.setCCloudComputePool",
      );
      assert.strictEqual(codeLenses[1].command?.title, pool.name);
      assert.deepStrictEqual(codeLenses[1].command?.arguments, [fakeDocument.uri]);
    });
  }

  it("should provide 'Submit Statement' codelens when a compute pool and catalog+database are set", async () => {
    const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    const database: CCloudKafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
    // simulate stored env + compute pool metadata
    const envWithPool: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [database],
      flinkComputePools: [pool],
    });
    ccloudLoaderStub.getEnvironments.resolves([envWithPool]);
    resourceManagerStub.getUriMetadata.resolves({
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
      [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
    });

    const provider = FlinkSqlCodelensProvider.getInstance();
    const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

    assert.strictEqual(codeLenses.length, 3);

    assert.strictEqual(codeLenses[0].command?.command, "confluent.statements.create");
    assert.strictEqual(codeLenses[0].command?.title, "▶️ Submit Statement");
    assert.deepStrictEqual(codeLenses[0].command?.arguments, [fakeDocument.uri, pool, database]);

    assert.strictEqual(
      codeLenses[1].command?.command,
      "confluent.document.flinksql.setCCloudCatalogDatabase",
    );
    assert.strictEqual(
      codeLenses[1].command?.title,
      `Catalog: ${TEST_CCLOUD_ENVIRONMENT.name}, Database: ${database.name}`,
    );
    assert.deepStrictEqual(codeLenses[1].command?.arguments, [fakeDocument.uri]);

    assert.strictEqual(
      codeLenses[2].command?.command,
      "confluent.document.flinksql.setCCloudComputePool",
    );
    assert.strictEqual(codeLenses[2].command?.title, pool.name);
    assert.deepStrictEqual(codeLenses[2].command?.arguments, [fakeDocument.uri]);

    assert.strictEqual(codeLenses[3].command?.command, "confluent.document.setCCloudOrg");
  });

  it("should create codelenses at the top of the document", async () => {
    const provider = FlinkSqlCodelensProvider.getInstance();
    const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

    const expectedRange = new Range(new Position(0, 0), new Position(0, 0));
    for (const lens of codeLenses) {
      assert.deepStrictEqual(lens.range, expectedRange);
    }
  });
});
