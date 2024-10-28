import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { TEST_SCHEMA_REGISTRY } from "../../tests/unit/testResources/schemaRegistry";
import { getExtensionContext } from "../../tests/unit/testUtils";
import * as local from "../graphql/local";
import * as org from "../graphql/organizations";
import { CCloudEnvironment, CCloudEnvironmentTreeItem } from "../models/environment";
import { KafkaClusterTreeItem, LocalKafkaCluster } from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { SchemaRegistryTreeItem } from "../models/schemaRegistry";
import * as auth from "../sidecar/connections";
import * as resourceManager from "../storage/resourceManager";
import { loadCCloudResources, loadLocalResources, ResourceViewProvider } from "./resources";

describe("ResourceViewProvider methods", () => {
  let provider: ResourceViewProvider;

  before(() => {
    provider = ResourceViewProvider.getInstance();
  });

  it("getTreeItem() should return a CCloudEnvironmentTreeItem for a CCloudEnvironment instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_ENVIRONMENT);
    assert.ok(treeItem instanceof CCloudEnvironmentTreeItem);
  });

  it("getTreeItem() should return a KafkaClusterTreeItem for a LocalKafkaCluster instance", () => {
    const treeItem = provider.getTreeItem(TEST_LOCAL_KAFKA_CLUSTER);
    assert.ok(treeItem instanceof KafkaClusterTreeItem);
  });

  it("getTreeItem() should return a KafkaClusterTreeItem for a CCloudKafkaCluster instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.ok(treeItem instanceof KafkaClusterTreeItem);
  });

  it("getTreeItem() should return a SchemaRegistryTreeItem for a SchemaRegistry instance", () => {
    const treeItem = provider.getTreeItem(TEST_SCHEMA_REGISTRY);
    assert.ok(treeItem instanceof SchemaRegistryTreeItem);
  });

  it("getTreeItem() should pass ContainerTreeItems through directly", () => {
    const container = new ContainerTreeItem<CCloudEnvironment>(
      "test",
      vscode.TreeItemCollapsibleState.Collapsed,
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
    await getExtensionContext();
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
    assert.equal(result.label, "Confluent Cloud");
    assert.equal(result.id, "ccloud-container-connected");
    assert.equal(result.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.equal(result.description, TEST_CCLOUD_ORGANIZATION.name);
    assert.deepStrictEqual(result.children, [TEST_CCLOUD_ENVIRONMENT]);
  });

  it("loadCCloudResources() should return a CCloud placeholder item when not connected", async () => {
    sandbox.stub(auth, "hasCCloudAuthSession").returns(false);

    const result: ContainerTreeItem<CCloudEnvironment> = await loadCCloudResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, "Confluent Cloud");
    assert.equal(result.id, "ccloud-container");
    assert.equal(result.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.equal(result.description, "(No connection)");
    assert.deepStrictEqual(result.children, []);
  });

  it("loadLocalResources() should load local resources under the Local container tree item when clusters are discoverable", async () => {
    sandbox.stub(local, "getLocalKafkaClusters").resolves([TEST_LOCAL_KAFKA_CLUSTER]);

    const result: ContainerTreeItem<LocalKafkaCluster> = await loadLocalResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, "Local");
    assert.equal(result.id, "local-container-connected");
    assert.equal(result.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.equal(result.description, TEST_LOCAL_KAFKA_CLUSTER.uri);
    assert.deepStrictEqual(result.children, [TEST_LOCAL_KAFKA_CLUSTER]);
  });

  it("loadLocalResources() should return a Local placeholder when no clusters are discoverable", async () => {
    sandbox.stub(local, "getLocalKafkaClusters").resolves([]);

    const result: ContainerTreeItem<LocalKafkaCluster> = await loadLocalResources();

    assert.ok(result instanceof ContainerTreeItem);
    assert.equal(result.label, "Local");
    assert.equal(result.id, "local-container");
    assert.equal(result.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.equal(result.description, "(Not running)");
    assert.deepStrictEqual(result.children, []);
  });
});
