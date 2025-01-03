import * as assert from "assert";
import sinon from "sinon";
import { TreeItemCollapsibleState, workspace } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_LOCAL_ENVIRONMENT,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import {
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources/schemaRegistry";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { EXTENSION_VERSION } from "../constants";
import * as direct from "../graphql/direct";
import * as local from "../graphql/local";
import * as org from "../graphql/organizations";
import {
  CCloudEnvironment,
  DirectEnvironment,
  EnvironmentTreeItem,
  LocalEnvironment,
} from "../models/environment";
import { KafkaClusterTreeItem, LocalKafkaCluster } from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { ConnectionLabel } from "../models/resource";
import { LocalSchemaRegistry, SchemaRegistryTreeItem } from "../models/schemaRegistry";
import { ENABLE_DIRECT_CONNECTIONS } from "../preferences/constants";
import * as auth from "../sidecar/connections";
import * as resourceManager from "../storage/resourceManager";
import {
  loadCCloudResources,
  loadDirectResources,
  loadLocalResources,
  ResourceViewProvider,
} from "./resources";

describe("ResourceViewProvider methods", () => {
  let provider: ResourceViewProvider;

  before(async () => {
    // ensure extension context is available for the ResourceViewProvider
    await getTestExtensionContext();
  });

  beforeEach(() => {
    provider = ResourceViewProvider.getInstance();
  });

  afterEach(() => {
    ResourceViewProvider["instance"] = null;
  });

  // TODO: add LocalEnvironment if/when we start showing that in the Resources view
  for (const resource of [TEST_CCLOUD_ENVIRONMENT, TEST_DIRECT_ENVIRONMENT]) {
    it(`getTreeItem() should return an EnvironmentTreeItem for a ${resource.constructor.name} instance`, () => {
      const treeItem = provider.getTreeItem(resource);
      assert.ok(treeItem instanceof EnvironmentTreeItem);
    });
  }

  it("getTreeItem() should return a KafkaClusterTreeItem for a LocalKafkaCluster instance", () => {
    const treeItem = provider.getTreeItem(TEST_LOCAL_KAFKA_CLUSTER);
    assert.ok(treeItem instanceof KafkaClusterTreeItem);
  });

  it("getTreeItem() should return a KafkaClusterTreeItem for a CCloudKafkaCluster instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.ok(treeItem instanceof KafkaClusterTreeItem);
  });

  it("getTreeItem() should return a SchemaRegistryTreeItem for a SchemaRegistry instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.ok(treeItem instanceof SchemaRegistryTreeItem);
  });

  it("getTreeItem() should pass ContainerTreeItems through directly", () => {
    const container = new ContainerTreeItem<CCloudEnvironment>(
      "test",
      TreeItemCollapsibleState.Collapsed,
      [TEST_CCLOUD_ENVIRONMENT],
    );
    const treeItem = provider.getTreeItem(container);
    assert.deepStrictEqual(treeItem, container);
  });
});

describe("ResourceViewProvider loading functions", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    // activate the extension once before this test suite runs
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("loadCCloudResources() should load CCloud resources under the Confluent Cloud container tree item when connected to CCloud", async () => {
    sandbox.stub(auth, "hasCCloudAuthSession").returns(true);
    sandbox.stub(org, "getCurrentOrganization").resolves(TEST_CCLOUD_ORGANIZATION);
    sandbox
      .stub(resourceManager.getResourceManager(), "getCCloudEnvironments")
      .resolves([TEST_CCLOUD_ENVIRONMENT]);

    const result: ContainerTreeItem<CCloudEnvironment> = await loadCCloudResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, ConnectionLabel.CCLOUD);
    assert.equal(result.id, `ccloud-connected-${EXTENSION_VERSION}`);
    assert.equal(result.collapsibleState, TreeItemCollapsibleState.Expanded);
    assert.equal(result.description, TEST_CCLOUD_ORGANIZATION.name);
    assert.deepStrictEqual(result.getChildren(), [TEST_CCLOUD_ENVIRONMENT]);
  });

  it("loadCCloudResources() should return a CCloud placeholder item when not connected", async () => {
    sandbox.stub(auth, "hasCCloudAuthSession").returns(false);

    const result: ContainerTreeItem<CCloudEnvironment> = await loadCCloudResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, ConnectionLabel.CCLOUD);
    assert.equal(result.id, `ccloud-${EXTENSION_VERSION}`);
    assert.equal(result.collapsibleState, TreeItemCollapsibleState.None);
    assert.equal(result.description, "(No connection)");
    assert.deepStrictEqual(result.getChildren(), []);
  });

  it("loadLocalResources() should load local resources under the Local container tree item when clusters are discoverable", async () => {
    const testLocalEnv: LocalEnvironment = new LocalEnvironment({
      ...TEST_LOCAL_ENVIRONMENT,
      kafkaClusters: [TEST_LOCAL_KAFKA_CLUSTER],
      schemaRegistry: TEST_LOCAL_SCHEMA_REGISTRY,
    });
    sandbox.stub(local, "getLocalResources").resolves([testLocalEnv]);

    const result: ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry> =
      await loadLocalResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, ConnectionLabel.LOCAL);
    assert.equal(result.id, `local-connected-${EXTENSION_VERSION}`);
    assert.equal(result.collapsibleState, TreeItemCollapsibleState.Expanded);
    assert.equal(result.description, TEST_LOCAL_KAFKA_CLUSTER.uri);
    assert.deepStrictEqual(result.getChildren(), [
      TEST_LOCAL_KAFKA_CLUSTER,
      TEST_LOCAL_SCHEMA_REGISTRY,
    ]);
  });

  it("loadLocalResources() should return a Local placeholder when no clusters are discoverable", async () => {
    sandbox.stub(local, "getLocalResources").resolves([]);

    const result: ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry> =
      await loadLocalResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, ConnectionLabel.LOCAL);
    assert.equal(result.id, `local-${EXTENSION_VERSION}`);
    assert.equal(result.collapsibleState, TreeItemCollapsibleState.None);
    assert.equal(result.description, "(Not running)");
    assert.deepStrictEqual(result.getChildren(), []);
  });

  it("loadDirectResources() should return an empty array when no direct connections exist", async () => {
    // TODO(shoup): remove this once direct connections are enabled by default
    // simulate the preview setting being enabled
    const getConfigurationStub: sinon.SinonStub = sandbox.stub(workspace, "getConfiguration");
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(ENABLE_DIRECT_CONNECTIONS).returns(true),
    });
    // but no direct connections exist
    sandbox.stub(direct, "getDirectResources").resolves([]);

    const result: DirectEnvironment[] = await loadDirectResources();

    assert.deepStrictEqual(result, []);
  });

  it("loadDirectResources() should return an empty array if the preview setting is disabled, even when direct connections exist", async () => {
    // TODO(shoup): remove this once direct connections are enabled by default
    // simulate the preview setting being disabled
    const getConfigurationStub: sinon.SinonStub = sandbox.stub(workspace, "getConfiguration");
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(ENABLE_DIRECT_CONNECTIONS).returns(false),
    });
    // and direct connections exist
    const testDirectEnv: DirectEnvironment = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });
    sandbox.stub(direct, "getDirectResources").resolves([testDirectEnv]);

    const result: DirectEnvironment[] = await loadDirectResources();

    assert.deepStrictEqual(result, []);
  });

  it("loadDirectResources() should return an array of direct 'environments' if direct connections exist and the preview setting is enabled", async () => {
    // TODO(shoup): remove this once direct connections are enabled by default
    // simulate the preview setting being disabled
    const getConfigurationStub: sinon.SinonStub = sandbox.stub(workspace, "getConfiguration");
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(ENABLE_DIRECT_CONNECTIONS).returns(true),
    });
    // and direct connections exist
    const testDirectEnv: DirectEnvironment = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });
    sandbox.stub(direct, "getDirectResources").resolves([testDirectEnv]);

    const result: DirectEnvironment[] = await loadDirectResources();

    assert.deepStrictEqual(result, [testDirectEnv]);
  });
});
