import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import {
  TEST_CCLOUD_FLINK_COMPUTE_POOL,
  TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
} from "../../tests/unit/testResources/flinkComputePool";
import * as flinkSqlProvider from "../codelens/flinkSqlProvider";
import { FLINKSTATEMENT_URI_SCHEME } from "../documentProviders/flinkStatement";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import * as ccloud from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { FlinkLanguageClientManager } from "./flinkLanguageClientManager";

describe("FlinkLanguageClientManager", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;
  let hasCCloudAuthSessionStub: sinon.SinonStub;
  let flinkManager: FlinkLanguageClientManager;
  let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let getCatalogDatabaseFromMetadataStub: sinon.SinonStub;
  let resourceManagerStub: sinon.SinonStubbedInstance<ResourceManager>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    FlinkLanguageClientManager["instance"] = null;
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    hasCCloudAuthSessionStub = sandbox.stub(ccloud, "hasCCloudAuthSession");
    hasCCloudAuthSessionStub.returns(false);
    ccloudLoaderStub = getStubbedCCloudResourceLoader(sandbox);
    getCatalogDatabaseFromMetadataStub = sandbox.stub(
      flinkSqlProvider,
      "getCatalogDatabaseFromMetadata",
    );

    resourceManagerStub = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(resourceManagerStub);
    const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    const database: CCloudKafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
    // simulate stored compute pool + database metadata
    resourceManagerStub.getUriMetadata.resolves({
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
      [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
    });
    const envWithPool: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [pool],
    });
    ccloudLoaderStub.getEnvironments.resolves([envWithPool]);
    flinkManager = FlinkLanguageClientManager.getInstance();
  });

  afterEach(() => {
    flinkManager.dispose();
    FlinkLanguageClientManager["instance"] = null;
    sandbox.restore();
  });

  describe("validateFlinkSettings", () => {
    it("should return false when computePoolId is missing", async () => {
      // no default Flink settings set
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, "").stubGet(FLINK_CONFIG_DATABASE, "");

      const result = await flinkManager.validateFlinkSettings(null);
      assert.strictEqual(result, false);
    });

    it("should return false when compute pool is invalid", async () => {
      // invalid default compute pool
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, "invalid-pool-id")
        .stubGet(FLINK_CONFIG_DATABASE, "");

      const result = await flinkManager.validateFlinkSettings("invalid-pool-id");
      assert.strictEqual(result, false);
    });

    it("should return true when compute pool is valid", async () => {
      // valid default compute pool
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL_ID)
        .stubGet(FLINK_CONFIG_DATABASE, "");

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, true);
    });

    it("should check resources availability when compute pool is set", async () => {
      // valid default Flink settings
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, true);
    });
  });

  describe("getFlinkSqlSettings", () => {
    const testUri = vscode.Uri.parse("file:///test.flink.sql");

    it("should return null for all settings if not configured", async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, "").stubGet(FLINK_CONFIG_DATABASE, "");
      resourceManagerStub.getUriMetadata.resolves(undefined);

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

      assert.deepStrictEqual(settings, {
        computePoolId: null,
        databaseName: null,
        catalogName: null,
      });
    });

    it("should return configs from workspace if set and uri metadata is undefined", async () => {
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, "config-pool-id")
        .stubGet(FLINK_CONFIG_DATABASE, "config-db-id");
      resourceManagerStub.getUriMetadata.resolves(undefined);

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

      assert.deepStrictEqual(settings, {
        computePoolId: "config-pool-id",
        // these are correctly null since fake DB id yields no results in getCatalogDatabaseFromMetadataStub
        databaseName: null,
        catalogName: null,
      });
    });

    it("should return db and catalog names with settings if found", async () => {
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL_ID)
        .stubGet(FLINK_CONFIG_DATABASE, "test-db");
      resourceManagerStub.getUriMetadata.resolves(undefined);

      // Mock the getCatalogDatabaseFromMetadata function to return catalog and database names
      getCatalogDatabaseFromMetadataStub.resolves({
        catalog: { name: "test-catalog-name" },
        database: { name: "test-db-name" },
      });

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

      sinon.assert.calledOnce(getCatalogDatabaseFromMetadataStub);
      assert.deepStrictEqual(settings, {
        computePoolId: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
        databaseName: "test-db-name",
        catalogName: "test-catalog-name",
      });
    });

    it("should prioritize URI metadata over workspace config settings", async () => {
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, "config-pool")
        .stubGet(FLINK_CONFIG_DATABASE, "config-db");
      resourceManagerStub.getUriMetadata.resolves({
        flinkComputePoolId: "metadata-pool",
        flinkDatabaseId: "metadata-db",
      });

      getCatalogDatabaseFromMetadataStub.resolves({
        catalog: { name: "metadata-catalog-name" },
        database: { name: "metadata-db-name" },
      });

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

      assert.deepStrictEqual(settings, {
        computePoolId: "metadata-pool",
        databaseName: "metadata-db-name",
        catalogName: "metadata-catalog-name",
      });
      sinon.assert.calledOnce(resourceManagerStub.getUriMetadata);
      sinon.assert.calledOnce(getCatalogDatabaseFromMetadataStub);
    });
  });
  describe("constructor behavior", () => {
    it("should initialize language client when has auth session & active flinksql document", async () => {
      hasCCloudAuthSessionStub.returns(true);
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      const fakeDocument = { languageId: "flinksql", uri: fakeUri } as vscode.TextDocument;
      const fakeEditor = { document: fakeDocument } as vscode.TextEditor;
      sandbox.stub(vscode.window, "activeTextEditor").value(fakeEditor);
      const maybeStartStub = sandbox
        .stub(FlinkLanguageClientManager.prototype, "maybeStartLanguageClient")
        .resolves();

      // Re-initialize the singleton so the constructor runs
      FlinkLanguageClientManager["instance"] = null;
      FlinkLanguageClientManager.getInstance();

      sinon.assert.calledOnce(maybeStartStub);
      sinon.assert.calledWith(maybeStartStub, fakeUri);
    });

    it("should initialize language client when has auth session & visible flinksql document (no active flinksql document)", async () => {
      hasCCloudAuthSessionStub.returns(true);

      // Non-flinksql active editor
      const nonFlinkDocument = {
        languageId: "typescript",
        uri: vscode.Uri.parse("file:///non/flink/doc.ts"),
      } as vscode.TextDocument;
      const nonFlinkEditor = { document: nonFlinkDocument } as vscode.TextEditor;
      sandbox.stub(vscode.window, "activeTextEditor").value(nonFlinkEditor);

      // Visible flinksql editor
      const fakeUri = vscode.Uri.parse("file:///fake/path/visible.flinksql");
      const fakeDocument = { languageId: "flinksql", uri: fakeUri } as vscode.TextDocument;
      const fakeEditor = { document: fakeDocument } as vscode.TextEditor;
      sandbox.stub(vscode.window, "visibleTextEditors").value([fakeEditor]);

      const maybeStartStub = sandbox
        .stub(FlinkLanguageClientManager.prototype, "maybeStartLanguageClient")
        .resolves();

      // Re-initialize the singleton so the constructor runs
      FlinkLanguageClientManager["instance"] = null;
      FlinkLanguageClientManager.getInstance();

      sinon.assert.calledOnce(maybeStartStub);
      sinon.assert.calledWith(maybeStartStub, fakeUri);
    });

    it("should not initialize language client when has auth session but no flinksql document is open", async () => {
      hasCCloudAuthSessionStub.returns(true);

      // No active editor
      sandbox.stub(vscode.window, "activeTextEditor").value(undefined);

      // No visible flinksql editors
      const nonFlinkDocument = {
        languageId: "typescript",
        uri: vscode.Uri.parse("file:///non/flink/doc.ts"),
      } as vscode.TextDocument;
      const nonFlinkEditor = { document: nonFlinkDocument } as vscode.TextEditor;
      sandbox.stub(vscode.window, "visibleTextEditors").value([nonFlinkEditor]);

      const maybeStartStub = sandbox
        .stub(FlinkLanguageClientManager.prototype, "maybeStartLanguageClient")
        .resolves();

      // Re-initialize the singleton so the constructor runs
      FlinkLanguageClientManager["instance"] = null;
      FlinkLanguageClientManager.getInstance();

      sinon.assert.notCalled(maybeStartStub);
    });

    it("should not initialize language client when not authenticated with CCloud", async () => {
      hasCCloudAuthSessionStub.returns(false);

      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      const fakeDocument = { languageId: "flinksql", uri: fakeUri } as vscode.TextDocument;
      const fakeEditor = { document: fakeDocument } as vscode.TextEditor;
      sandbox.stub(vscode.window, "activeTextEditor").value(fakeEditor);

      const maybeStartStub = sandbox
        .stub(FlinkLanguageClientManager.prototype, "maybeStartLanguageClient")
        .resolves();

      // Re-initialize the singleton so the constructor runs
      FlinkLanguageClientManager["instance"] = null;
      FlinkLanguageClientManager.getInstance();

      sinon.assert.notCalled(maybeStartStub);
    });
  });

  describe("document tracking", () => {
    it("should add open flink documents to the tracking set when initializing", () => {
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      const fakeDocument = { languageId: "flinksql", uri: fakeUri } as vscode.TextDocument;
      sandbox.stub(vscode.workspace, "textDocuments").value([fakeDocument]);

      // Re-initialize the singleton so the constructor runs
      FlinkLanguageClientManager["instance"] = null;
      flinkManager = FlinkLanguageClientManager.getInstance();

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 1);
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].has(fakeUri.toString()), true);
    });

    it("should track documents when opened", () => {
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      const fakeDocument = { languageId: "flinksql", uri: fakeUri } as vscode.TextDocument;
      sandbox.stub(vscode.workspace, "textDocuments").value([fakeDocument]);

      flinkManager.trackDocument(fakeUri);

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 1);
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].has(fakeUri.toString()), true);
    });

    it("should untrack documents when closed", () => {
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      flinkManager.trackDocument(fakeUri);
      flinkManager.untrackDocument(fakeUri);

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 0);
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].has(fakeUri.toString()), false);
    });

    it("should not track readonly statements", () => {
      const fakeUri = vscode.Uri.parse(`${FLINKSTATEMENT_URI_SCHEME}:///fake/path/test.flinksql`);
      const fakeDocument = {
        languageId: "flinksql",
        uri: fakeUri,
      } as vscode.TextDocument;
      sandbox.stub(vscode.workspace, "textDocuments").value([fakeDocument]);

      flinkManager.trackDocument(fakeUri);

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 0);
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].has(fakeUri.toString()), false);
    });
  });
});
