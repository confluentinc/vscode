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
    it(`getTreeItem() should return a KafkaClusterTreeItem for a ${cluster.connectionType} Kafka cluster instance`, async () => {
      const treeItem = await provider.getTreeItem(cluster);
      assert.ok(treeItem instanceof KafkaClusterTreeItem);
    });
  }

  for (const registry of [
    TEST_CCLOUD_SCHEMA_REGISTRY,
    TEST_DIRECT_SCHEMA_REGISTRY,
    TEST_LOCAL_SCHEMA_REGISTRY,
  ]) {
    it(`getTreeItem() should return a SchemaRegistryTreeItem for a ${registry.connectionType} Schema Registry instance`, async () => {
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
    assert.deepStrictEqual(result.children, [TEST_CCLOUD_ENVIRONMENT]);
  });

  it("loadCCloudResources() should return a CCloud placeholder item when not connected", async () => {
    sandbox.stub(auth, "hasCCloudAuthSession").returns(false);

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
});
