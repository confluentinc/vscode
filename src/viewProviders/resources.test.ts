import * as assert from "assert";
import sinon from "sinon";
import { TreeItemCollapsibleState } from "vscode";
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
import * as contextValues from "../context/values";
import { resourceSearchSet } from "../emitters";
import * as direct from "../graphql/direct";
import * as local from "../graphql/local";
import * as org from "../graphql/organizations";
import { CCloudResourceLoader } from "../loaders";
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
import * as ccloudConnections from "../sidecar/connections/ccloud";
import * as localConnections from "../sidecar/connections/local";
import * as resourceManager from "../storage/resourceManager";
import {
  loadCCloudResources,
  loadDirectResources,
  loadLocalResources,
  ResourceViewProvider,
} from "./resources";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";

describe("ResourceViewProvider methods", () => {
  let provider: ResourceViewProvider;
  let sandbox: sinon.SinonSandbox;
  let getDirectConnectionsStub: sinon.SinonStub;

  before(async () => {
    // ensure extension context is available for the ResourceViewProvider
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getDirectConnectionsStub = sandbox.stub(
      resourceManager.getResourceManager(),
      "getDirectConnections",
    );

    provider = ResourceViewProvider.getInstance();
  });

  afterEach(() => {
    sandbox.restore();
    ResourceViewProvider["instance"] = null;
  });

  for (const resource of [
    TEST_CCLOUD_ENVIRONMENT,
    TEST_LOCAL_ENVIRONMENT,
    TEST_DIRECT_ENVIRONMENT,
  ]) {
    it(`getTreeItem() should return an EnvironmentTreeItem for a ${resource.constructor.name} instance`, async () => {
      const treeItem = await provider.getTreeItem(resource);
      assert.ok(treeItem instanceof EnvironmentTreeItem);
    });
  }

  for (const cluster of [
    TEST_CCLOUD_KAFKA_CLUSTER,
    TEST_DIRECT_KAFKA_CLUSTER,
    TEST_LOCAL_KAFKA_CLUSTER,
  ]) {
    it(`getTreeItem() should return a KafkaClusterTreeItem for a ${cluster.constructor.name} instance`, async () => {
      const treeItem = await provider.getTreeItem(cluster);
      assert.ok(treeItem instanceof KafkaClusterTreeItem);
    });
  }

  for (const registry of [
    TEST_CCLOUD_SCHEMA_REGISTRY,
    TEST_DIRECT_SCHEMA_REGISTRY,
    TEST_LOCAL_SCHEMA_REGISTRY,
  ]) {
    it(`getTreeItem() should return a SchemaRegistryTreeItem for a ${registry.constructor.name} instance`, async () => {
      const treeItem = await provider.getTreeItem(registry);
      assert.ok(treeItem instanceof SchemaRegistryTreeItem);
    });
  }

  it("getTreeItem() should pass ContainerTreeItems through directly", async () => {
    const container = new ContainerTreeItem<CCloudEnvironment>(
      "test",
      TreeItemCollapsibleState.Collapsed,
      [TEST_CCLOUD_ENVIRONMENT],
    );
    const treeItem = await provider.getTreeItem(container);
    assert.deepStrictEqual(treeItem, container);
  });

  it("removeUnusedDirectEnvironments() should update the environmentsMap to remove any deleted direct connections", async () => {
    provider.environmentsMap = new Map([
      [TEST_DIRECT_ENVIRONMENT.id, TEST_DIRECT_ENVIRONMENT],
      ["env2", new DirectEnvironment({ ...TEST_DIRECT_ENVIRONMENT, id: "env2" })],
    ]);
    // simulate "env2" being deleted from storage and GQL
    getDirectConnectionsStub.resolves(
      new Map([[TEST_DIRECT_ENVIRONMENT.id, TEST_DIRECT_ENVIRONMENT]]),
    );
    sandbox.stub(direct, "getDirectResources").resolves([TEST_DIRECT_ENVIRONMENT]);

    await provider.removeUnusedEnvironments();

    assert.strictEqual(provider.environmentsMap.size, 1);
    assert.ok(provider.environmentsMap.has(TEST_DIRECT_ENVIRONMENT.id));
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
    sandbox.stub(ccloudConnections, "hasCCloudAuthSession").returns(true);
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
    assert.deepStrictEqual(result.children, [TEST_CCLOUD_ENVIRONMENT]);
  });

  it("loadCCloudResources() should return a CCloud placeholder item when not connected", async () => {
    sandbox.stub(ccloudConnections, "hasCCloudAuthSession").returns(false);

    const result: ContainerTreeItem<CCloudEnvironment> = await loadCCloudResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, ConnectionLabel.CCLOUD);
    assert.equal(result.id, `ccloud-${EXTENSION_VERSION}`);
    assert.equal(result.collapsibleState, TreeItemCollapsibleState.None);
    assert.equal(result.description, "(No connection)");
    assert.deepStrictEqual(result.children, []);
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
    assert.deepStrictEqual(result.children, [TEST_LOCAL_KAFKA_CLUSTER, TEST_LOCAL_SCHEMA_REGISTRY]);
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
    assert.deepStrictEqual(result.children, []);
  });

  it("loadDirectResources() should return an empty array when no direct connections exist", async () => {
    // no direct connections exist
    sandbox.stub(direct, "getDirectResources").resolves([]);

    const result: DirectEnvironment[] = await loadDirectResources();

    assert.deepStrictEqual(result, []);
  });

  it("loadDirectResources() should return an array of direct 'environments' if direct connections exist", async () => {
    // direct connections exist
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

describe("ResourceViewProvider context value updates", () => {
  let provider: ResourceViewProvider;
  let sandbox: sinon.SinonSandbox;
  let setContextValueStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    provider = ResourceViewProvider.getInstance();
    setContextValueStub = sandbox.stub(contextValues, "setContextValue");
  });

  afterEach(() => {
    sandbox.restore();
    ResourceViewProvider["instance"] = null;
  });

  it("getTreeItem() should update context values correctly when a direct environment has no resources", async () => {
    const emptyDirectEnv = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [],
      schemaRegistry: undefined,
    });
    provider.environmentsMap.set(emptyDirectEnv.id, emptyDirectEnv);

    await provider.getTreeItem(emptyDirectEnv);

    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directKafkaClusterAvailable,
        false,
      ),
    );
    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directSchemaRegistryAvailable,
        false,
      ),
    );
  });

  it("getTreeItem() should update context values correctly when a direct environment only has a Kafka cluster", async () => {
    const kafkaOnlyDirectEnv = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      schemaRegistry: undefined,
    });
    provider.environmentsMap.set(kafkaOnlyDirectEnv.id, kafkaOnlyDirectEnv);

    await provider.getTreeItem(kafkaOnlyDirectEnv);

    assert.ok(
      setContextValueStub.calledWith(contextValues.ContextValues.directKafkaClusterAvailable, true),
    );
    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directSchemaRegistryAvailable,
        false,
      ),
    );
  });

  it("getTreeItem() should update context values correctly when a direct environment only has a Schema Registry", async () => {
    const srOnlyDirectEnv = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [],
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });
    provider.environmentsMap.set(srOnlyDirectEnv.id, srOnlyDirectEnv);

    await provider.getTreeItem(srOnlyDirectEnv);

    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directKafkaClusterAvailable,
        false,
      ),
    );
    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directSchemaRegistryAvailable,
        true,
      ),
    );
  });

  it("getTreeItem() should handle multiple direct environments correctly when updating context values", async () => {
    const env1 = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      id: "env1",
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      schemaRegistry: undefined,
    });
    const env2 = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      id: "env2",
      kafkaClusters: [],
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });

    provider.environmentsMap.set(env1.id, env1);
    provider.environmentsMap.set(env2.id, env2);

    await provider.getTreeItem(env1);

    // from env1
    assert.ok(
      setContextValueStub.calledWith(contextValues.ContextValues.directKafkaClusterAvailable, true),
    );
    // from env2
    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directSchemaRegistryAvailable,
        true,
      ),
    );
    // should not set `false` since env1 has a Kafka cluster
    assert.ok(
      setContextValueStub.neverCalledWith(
        contextValues.ContextValues.directKafkaClusterAvailable,
        false,
      ),
    );
    // should not set `false` since env2 has a Schema Registry
    assert.ok(
      setContextValueStub.neverCalledWith(
        contextValues.ContextValues.directSchemaRegistryAvailable,
        false,
      ),
    );
  });

  it("refresh() should update context values correctly when no direct environments exist", () => {
    provider.environmentsMap = new Map();

    provider.refresh();

    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directKafkaClusterAvailable,
        false,
      ),
    );
    assert.ok(
      setContextValueStub.calledWith(
        contextValues.ContextValues.directSchemaRegistryAvailable,
        false,
      ),
    );
  });
});

describe("ResourceViewProvider search behavior", () => {
  let provider: ResourceViewProvider;
  let ccloudLoader: CCloudResourceLoader;

  let sandbox: sinon.SinonSandbox;
  let ccloudLoaderGetEnvironmentsStub: sinon.SinonStub;
  let ccloudGetKafkaClustersForEnvironmentIdStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    ccloudLoader = CCloudResourceLoader.getInstance();
    ccloudLoaderGetEnvironmentsStub = sandbox.stub(ccloudLoader, "getEnvironments").resolves([]);
    ccloudGetKafkaClustersForEnvironmentIdStub = sandbox
      .stub(ccloudLoader, "getKafkaClustersForEnvironmentId")
      .resolves([]);

    // stub all the calls within loadCCloudResources() since we can't stub it directly
    sandbox.stub(ccloudConnections, "hasCCloudAuthSession").returns(true);
    sandbox.stub(org, "getCurrentOrganization").resolves(TEST_CCLOUD_ORGANIZATION);
    sandbox.stub(localConnections, "updateLocalConnection").resolves();
    sandbox.stub(local, "getLocalResources").resolves([]);
    sandbox.stub(direct, "getDirectResources").resolves([]);
    sandbox.stub(ccloudLoader, "getSchemaRegistryForEnvironmentId").resolves();

    provider = ResourceViewProvider.getInstance();
    // skip any direct connection rehydration behavior for these tests
    provider["rehydratedDirectConnections"] = true;
  });

  afterEach(() => {
    ResourceViewProvider["instance"] = null;
    CCloudResourceLoader["instance"] = null;

    sandbox.restore();
  });

  it("getChildren() should filter root-level items based on search string", async () => {
    ccloudLoaderGetEnvironmentsStub.resolves([TEST_CCLOUD_ENVIRONMENT]);
    // CCloud environment name matches the search string
    resourceSearchSet.fire(TEST_CCLOUD_ENVIRONMENT.name);

    const rootElements = await provider.getChildren();

    assert.strictEqual(rootElements.length, 1);
    const container = rootElements[0] as ContainerTreeItem<CCloudEnvironment>;
    assert.strictEqual(container.label, ConnectionLabel.CCLOUD);
    assert.ok(
      container instanceof ContainerTreeItem &&
        container.children.includes(TEST_CCLOUD_ENVIRONMENT),
    );
  });

  it("getChildren() should filter element children based on search string", async () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });
    ccloudLoaderGetEnvironmentsStub.resolves([env]);
    ccloudGetKafkaClustersForEnvironmentIdStub.resolves(env.kafkaClusters);
    // Kafka cluster name matches the search string
    resourceSearchSet.fire(TEST_CCLOUD_KAFKA_CLUSTER.name);

    const children = await provider.getChildren(env);

    assert.deepStrictEqual(children, [TEST_CCLOUD_KAFKA_CLUSTER]);
  });

  it("getChildren() should show correct count in tree view message when items match search", async () => {
    // the message won't populate for the root-level items that don't match, so simulate a container
    // being expanded that has a matching child
    const container = new ContainerTreeItem<CCloudEnvironment>(
      ConnectionLabel.CCLOUD,
      TreeItemCollapsibleState.Expanded,
      [TEST_CCLOUD_ENVIRONMENT],
    );
    ccloudLoaderGetEnvironmentsStub.resolves([TEST_CCLOUD_ENVIRONMENT]);
    // CCloud environment name matches the search string
    const searchStr = TEST_CCLOUD_ENVIRONMENT.name;
    resourceSearchSet.fire(searchStr);

    await provider.getChildren(container);

    // fresh provider for this test, only tracked 1 item returned for its totalItemCount
    assert.strictEqual(provider.searchMatches.size, 1);
    assert.strictEqual(provider.totalItemCount, 1);
    assert.strictEqual(
      provider["treeView"].message,
      `Showing 1 of ${provider.totalItemCount} result for "${searchStr}"`,
    );
  });

  it("getChildren() should clear tree view message when search is cleared", async () => {
    resourceSearchSet.fire(null);

    await provider.getChildren();

    assert.strictEqual(provider["treeView"].message, undefined);
  });

  it("getTreeItem() should set the resourceUri of tree items whose label matches the search string", async () => {
    // CCloud environment name matches the search string
    resourceSearchSet.fire(TEST_CCLOUD_ENVIRONMENT.name);

    const treeItem = (await provider.getTreeItem(TEST_CCLOUD_ENVIRONMENT)) as EnvironmentTreeItem;

    assert.ok(treeItem.resourceUri);
    assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
  });

  it("getTreeItem() should indicate description matches with a highlighted asterisk", async () => {
    // Kafka cluster ID (shown as description) matches the search string
    resourceSearchSet.fire(TEST_CCLOUD_KAFKA_CLUSTER.id);

    const treeItem = (await provider.getTreeItem(
      TEST_CCLOUD_KAFKA_CLUSTER,
    )) as KafkaClusterTreeItem;

    assert.ok(treeItem.resourceUri);
    assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
  });

  it("getTreeItem() should expand parent items when children match search", async () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });
    // Kafka cluster name matches the search string
    resourceSearchSet.fire(TEST_CCLOUD_KAFKA_CLUSTER.name);

    const treeItem = await provider.getTreeItem(env);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Expanded);
  });

  it("getTreeItem() should collapse items when children exist but don't match search", async () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });
    // unrelated search string compared to env + cluster values
    resourceSearchSet.fire("non-matching-search");

    const treeItem = await provider.getTreeItem(env);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
  });
});
