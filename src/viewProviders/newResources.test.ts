import * as assert from "assert";
import sinon from "sinon";
import { MarkdownString, TreeItem, TreeItemCollapsibleState } from "vscode";
import * as environmentModels from "../../src/models/environment";
import * as notifications from "../../src/notifications";
import * as ccloudConnections from "../../src/sidecar/connections/ccloud";
import * as sidecarLocalConnections from "../../src/sidecar/connections/local";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_ENVIRONMENT,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ConnectionType } from "../clients/sidecar/models/ConnectionType";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import {
  CCloudResourceLoader,
  DirectResourceLoader,
  LocalResourceLoader,
  ResourceLoader,
} from "../loaders";
import {
  CCloudEnvironment,
  DirectEnvironment,
  EnvironmentTreeItem,
  LocalEnvironment,
} from "../models/environment";
import { FlinkComputePoolTreeItem } from "../models/flinkComputePool";
import { KafkaClusterTreeItem } from "../models/kafkaCluster";
import { ConnectionId } from "../models/resource";
import { SchemaRegistryTreeItem } from "../models/schemaRegistry";
import { ConnectionStateWatcher } from "../sidecar/connections/watcher";
import {
  AnyConnectionRow,
  CCloudConnectionRow,
  DirectConnectionRow,
  LocalConnectionRow,
  mergeUpdates,
  NewResourceViewProvider,
  SingleEnvironmentConnectionRow,
} from "./newResources";

describe("viewProviders/newResources.ts", () => {
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

  describe("DirectConnectionRow", () => {
    let directLoader: DirectResourceLoader;
    let directConnectionRow: DirectConnectionRow;

    const TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });

    const TEST_DIRECT_ENVIRONMENT_WITH_KAFKA = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
    });

    const TEST_DIRECT_ENVIRONMENT_WITH_SR = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });

    beforeEach(() => {
      directLoader = new DirectResourceLoader("test-direct-connection-id" as ConnectionId);
      directConnectionRow = new DirectConnectionRow(directLoader);
    });

    describe("ConnectionRow getters via DirectConnectionRow", () => {
      it("connectionId returns the loader's connectionId", () => {
        assert.strictEqual(directConnectionRow.connectionId, directLoader.connectionId);
      });

      it("id returns the loader's connectionId", () => {
        assert.strictEqual(directConnectionRow.id, directLoader.connectionId);
      });

      it("connectionType returns the connection type", () => {
        assert.strictEqual(directConnectionRow.connectionType, ConnectionType.Direct);
      });
    });

    describe("ConnectionRow methods via DirectConnectionRow", () => {
      describe("refresh", () => {
        let getEnvironmentsStub: sinon.SinonStub;

        beforeEach(() => {
          getEnvironmentsStub = sandbox.stub(directLoader, "getEnvironments").resolves([]);
        });

        for (const deepRefresh of [true, false] as const) {
          it(`calls getEnvironments with deepRefresh=${deepRefresh}`, async () => {
            await directConnectionRow.refresh(deepRefresh);
            sinon.assert.calledOnceWithExactly(getEnvironmentsStub, deepRefresh);
          });
        }

        it("properly merges environment into initially empty environments array", async () => {
          assert.strictEqual(directConnectionRow.environments.length, 0);
          getEnvironmentsStub.resolves([TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR]);
          await directConnectionRow.refresh();
          assert.strictEqual(directConnectionRow.environments.length, 1);
          assert.deepStrictEqual(
            directConnectionRow.environments[0],
            TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR,
          );
        });

        it("properly merges updated environment into populated array", async () => {
          // initially no SR. Be sure to make a transient object here, 'cause is
          // going to get mutated during the refresh.
          directConnectionRow.environments.push(
            new DirectEnvironment({ ...TEST_DIRECT_ENVIRONMENT_WITH_KAFKA }),
          );
          getEnvironmentsStub.resolves([TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR]);

          await directConnectionRow.refresh();

          assert.strictEqual(directConnectionRow.environments.length, 1);
          assert.deepStrictEqual(
            directConnectionRow.environments[0],
            TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR,
          );
        });

        it("searchableText doesn't vomit", async () => {
          // Refine this test later on.
          getEnvironmentsStub.resolves([TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR]);
          await directConnectionRow.refresh();
          assert.strictEqual(directConnectionRow.name, directConnectionRow.searchableText());
        });
      });
    });

    describe("SingleEnvironmentConnectionRow methods via DirectConnectionRow", () => {
      describe("getChildren", () => {
        it("returns kafka and schema registry children when both are set", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR);
          const children = directConnectionRow.getChildren();
          assert.strictEqual(children.length, 2);
          assert.strictEqual(children[0].name, TEST_DIRECT_KAFKA_CLUSTER.name);
          assert.strictEqual(children[1].name, TEST_DIRECT_SCHEMA_REGISTRY.name);
        });

        it("returns only kafka child when schema registry is not set", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA);
          const children = directConnectionRow.getChildren();
          assert.strictEqual(children.length, 1);
          assert.deepStrictEqual(children[0], TEST_DIRECT_KAFKA_CLUSTER);
        });

        it("returns only schema registry child when kafka is not set", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_SR);
          const children = directConnectionRow.getChildren();
          assert.strictEqual(children.length, 1);
          assert.deepStrictEqual(children[0], TEST_DIRECT_SCHEMA_REGISTRY);
        });

        it("returns empty array when no environment is set", () => {
          const children = directConnectionRow.getChildren();
          assert.strictEqual(children.length, 0);
        });
      });
    });

    describe("SingleConnectionRow getters via DirectConnectionRow", () => {
      describe("kafkaCluster", () => {
        it("Returns the first Kafka cluster from the environment when set", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR);
          assert.strictEqual(directConnectionRow.kafkaCluster, TEST_DIRECT_KAFKA_CLUSTER);
        });

        it("Returns undefined when no environment is set", () => {
          assert.strictEqual(directConnectionRow.kafkaCluster, undefined);
        });
      });

      describe("schemaRegistry", () => {
        it("Returns the Schema Registry from the environment when set", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR);
          assert.strictEqual(directConnectionRow.schemaRegistry, TEST_DIRECT_SCHEMA_REGISTRY);
        });

        it("Returns undefined when no environment is set", () => {
          assert.strictEqual(directConnectionRow.schemaRegistry, undefined);
        });
      });

      describe("connected", () => {
        it("returns true when the environment has a Kafka cluster", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA);
          assert.strictEqual(directConnectionRow.connected, true);
        });

        it("returns true when the environment has a schema registry", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_SR);
          assert.strictEqual(directConnectionRow.connected, true);
        });

        it("returns true when the environment has a both kafka and schema registry", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR);
          assert.strictEqual(directConnectionRow.connected, true);
        });

        it("returns false when the environment is missing Kafka AND Schema Registry", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT);
          assert.strictEqual(directConnectionRow.connected, false);
        });

        it("returns false when no environment is set", () => {
          assert.strictEqual(directConnectionRow.connected, false);
        });
      });
    });

    describe("getters", () => {
      describe("iconpath", () => {
        it("throws when no environment", () => {
          assert.throws(() => {
            return directConnectionRow.iconPath;
          }, /Environment not yet loaded/);
        });

        it("returns the environment's icon when env is loaded and nothing is missing", () => {
          sandbox
            .stub(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR, "checkForMissingResources")
            .returns({ missingKafka: false, missingSR: false });
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR);
          assert.strictEqual(
            directConnectionRow.iconPath.id,
            TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR.iconName,
          );
        });

        it("returns warning icon when environment is loaded but missing configured Kafka or Schema Registry", () => {
          sandbox
            .stub(TEST_DIRECT_ENVIRONMENT, "checkForMissingResources")
            .returns({ missingKafka: true, missingSR: true });
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT);
          assert.strictEqual(directConnectionRow.iconPath.id, "warning");
        });
      });

      describe("name", () => {
        it("returns the environment name when set", () => {
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR);
          assert.strictEqual(
            directConnectionRow.name,
            TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR.name,
          );
        });

        it("throws when no environment is set", () => {
          assert.throws(() => {
            return directConnectionRow.name;
          }, /Environment not yet loaded/);
        });
      });

      describe("status", () => {
        it("returns empty string", () => {
          assert.strictEqual(directConnectionRow.status, "");
        });
      });

      describe("tooltip", () => {
        it("calls + returns createEnvironmentTooltip() result when env set", () => {
          const envToolTipStub = sandbox.stub(environmentModels, "createEnvironmentTooltip");
          envToolTipStub.returns(new MarkdownString("Test tooltip"));
          directConnectionRow.environments.push(TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR);
          assert.strictEqual(directConnectionRow.tooltip.value, "Test tooltip");
          sinon.assert.calledOnce(envToolTipStub);
        });

        it("throws when no environment is set", () => {
          assert.throws(() => {
            return directConnectionRow.tooltip;
          }, /Environment not yet loaded/);
        });
      });
    });

    describe("getEnvironments", () => {
      let loaderGetEnvironmentsStub: sinon.SinonStub;
      let getLatestConnectionEventStub: sinon.SinonStub;

      beforeEach(() => {
        loaderGetEnvironmentsStub = sandbox.stub(directLoader, "getEnvironments");
        getLatestConnectionEventStub = sandbox.stub(
          ConnectionStateWatcher.getInstance(),
          "getLatestConnectionEvent",
        );
      });

      it("behavior when no environment found", async () => {
        loaderGetEnvironmentsStub.resolves([]);
        const environments = await directConnectionRow.getEnvironments();
        assert.deepStrictEqual(environments, []);
      });

      it("behavior when environment found but no latest websocket event", async () => {
        loaderGetEnvironmentsStub.resolves([TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR]);
        const environments = await directConnectionRow.getEnvironments();

        sinon.assert.calledOnce(loaderGetEnvironmentsStub);
        sinon.assert.calledOnce(getLatestConnectionEventStub);
        sinon.assert.calledWith(getLatestConnectionEventStub, directLoader.connectionId);

        assert.deepStrictEqual(environments, [TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR]);
        assert.strictEqual(environments[0].kafkaConnectionFailed, undefined);
        assert.strictEqual(environments[0].schemaRegistryConnectionFailed, undefined);
      });

      it("behavior when environment found but has a websocket event", async () => {
        loaderGetEnvironmentsStub.resolves([TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR]);

        getLatestConnectionEventStub.returns({
          connection: {
            status: {
              kafka_cluster: { errors: { sign_in: { message: "Failed to kafka" } } },
              schema_registry: { errors: { sign_in: { message: "Failed to schema" } } },
            },
          },
        });

        const environments = await directConnectionRow.getEnvironments();

        sinon.assert.calledOnce(loaderGetEnvironmentsStub);
        sinon.assert.calledOnce(getLatestConnectionEventStub);
        sinon.assert.calledWith(getLatestConnectionEventStub, directLoader.connectionId);

        assert.strictEqual(environments[0].kafkaConnectionFailed, "Failed to kafka");
        assert.strictEqual(environments[0].schemaRegistryConnectionFailed, "Failed to schema");
      });
    });
  });

  describe("LocalConnectionRow", () => {
    let localConnectionRow: LocalConnectionRow;
    let localLoader = LocalResourceLoader.getInstance();

    // TEST_LOCAL_ENVIRONMENT doesn't have Kafka or Schema Registry configured,
    // so make a version that does for connected-state testing.
    const TEST_LOCAL_ENVIRONMENT_WITH_KAFKA_AND_SR = new LocalEnvironment({
      ...TEST_LOCAL_ENVIRONMENT,
      kafkaClusters: [TEST_LOCAL_KAFKA_CLUSTER],
      schemaRegistry: TEST_LOCAL_SCHEMA_REGISTRY,
    });

    beforeEach(() => {
      localConnectionRow = new LocalConnectionRow();
    });

    it("should create a new LocalConnectionRow instance over the LocalResourceLoader", () => {
      assert.ok(localConnectionRow);
      assert.deepStrictEqual(localConnectionRow.loader, LocalResourceLoader.getInstance());
    });

    it("name getter should return the correct name", () => {
      assert.strictEqual(localConnectionRow.name, "Local");
    });

    it("iconPath getter should return the correct icon", () => {
      assert.strictEqual(localConnectionRow.iconPath.id, IconNames.LOCAL_RESOURCE_GROUP);
    });

    it("tooltip getter should return the correct tooltip", () => {
      assert.ok(/Local Kafka clusters/.test(localConnectionRow.tooltip.value));
    });

    it("status getter should return the correct status", () => {
      // w/o a connection ...
      assert.strictEqual(localConnectionRow.status, "(Not Running)");

      // ... and with a fully fleshed out connection
      localConnectionRow.environments.push(TEST_LOCAL_ENVIRONMENT_WITH_KAFKA_AND_SR);
      assert.strictEqual(
        localConnectionRow.status,
        TEST_LOCAL_ENVIRONMENT_WITH_KAFKA_AND_SR.kafkaClusters[0].uri!,
      );
    });

    describe("ConnectionRow methods via LocalConnectionRow", () => {
      describe("getEnvironments", () => {
        let loaderGetEnvironmentsStub: sinon.SinonStub;

        beforeEach(() => {
          loaderGetEnvironmentsStub = sandbox.stub(localLoader, "getEnvironments").resolves([]);
        });

        it("calls loader.getEnvironments with deepRefresh=false", async () => {
          await localConnectionRow.getEnvironments();
          sinon.assert.calledOnceWithExactly(loaderGetEnvironmentsStub, false);
        });

        it("returns the environments from the loader", async () => {
          const expectedEnvironments = [TEST_LOCAL_ENVIRONMENT];
          loaderGetEnvironmentsStub.resolves(expectedEnvironments);
          const environments = await localConnectionRow.getEnvironments();
          assert.deepStrictEqual(environments, expectedEnvironments);
        });
      });

      describe("getTreeItem", () => {
        it("when connected", () => {
          localConnectionRow.environments.push(TEST_LOCAL_ENVIRONMENT_WITH_KAFKA_AND_SR);
          const treeItem = localConnectionRow.getTreeItem();
          assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Expanded);
          assert.strictEqual(treeItem.contextValue, "local-container-connected");
          assert.strictEqual(treeItem.id, `${TEST_LOCAL_ENVIRONMENT.connectionId}-connected`);
        });

        const notConnectedTestCases: Array<[string, LocalEnvironment | undefined]> = [
          ["when not connected, no environment", undefined],
          ["when not connected, empty environment", TEST_LOCAL_ENVIRONMENT],
        ];

        for (const [label, environment] of notConnectedTestCases) {
          it(label, () => {
            if (environment) {
              localConnectionRow.environments.push(environment);
            }
            const treeItem = localConnectionRow.getTreeItem();
            assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.None);
            assert.strictEqual(treeItem.contextValue, "local-container");
            assert.strictEqual(treeItem.id, `${TEST_LOCAL_ENVIRONMENT.connectionId}`);
          });
        }
      });
    });

    describe("refresh", () => {
      let updateLocalConnectionStub: sinon.SinonStub;
      let singleEnvironmentConnectionRowRefresh: sinon.SinonStub;

      beforeEach(() => {
        updateLocalConnectionStub = sandbox.stub(sidecarLocalConnections, "updateLocalConnection");

        singleEnvironmentConnectionRowRefresh = sandbox.stub(
          SingleEnvironmentConnectionRow.prototype,
          "refresh",
        );
      });

      it("calls updateLocalConnection when needed", async () => {
        assert.equal(localConnectionRow["needUpdateLocalConnection"], true);
        await localConnectionRow.refresh(false);
        assert.ok(updateLocalConnectionStub.calledOnce);
        assert.equal(localConnectionRow["needUpdateLocalConnection"], false);
      });

      it("downcalls into SingleEnvironmentConnectionRow.refresh", async () => {
        await localConnectionRow.refresh(false);
        sinon.assert.calledOnce(singleEnvironmentConnectionRowRefresh);
      });
    });
  });

  describe("CCloudConnectionRow", () => {
    let ccloudConnectionRow: CCloudConnectionRow;
    let ccloudLoader: CCloudResourceLoader;

    beforeEach(() => {
      ccloudConnectionRow = new CCloudConnectionRow();
      ccloudLoader = CCloudResourceLoader.getInstance();
    });

    describe("getters", () => {
      it("name getter should return the correct name", () => {
        assert.strictEqual(ccloudConnectionRow.name, "Confluent Cloud");
      });

      it("iconPath getter should return the correct icon", () => {
        assert.strictEqual(ccloudConnectionRow.iconPath.id, IconNames.CONFLUENT_LOGO);
      });

      it("tooltip", () => {
        assert.strictEqual(ccloudConnectionRow.tooltip, "Confluent Cloud");
      });

      describe("When connected", () => {
        beforeEach(() => {
          ccloudConnectionRow.environments.push(TEST_CCLOUD_ENVIRONMENT);
          ccloudConnectionRow.ccloudOrganization = TEST_CCLOUD_ORGANIZATION;
        });

        it("connected()", () => {
          ccloudConnectionRow.environments.push(TEST_CCLOUD_ENVIRONMENT);
          assert.strictEqual(ccloudConnectionRow.connected, true);
        });

        it("status", () => {
          assert.strictEqual(ccloudConnectionRow.status, TEST_CCLOUD_ORGANIZATION.name);
        });
      });

      describe("When not connected", () => {
        it("connected()", () => {
          assert.strictEqual(ccloudConnectionRow.connected, false);
        });
        it("status", () => {
          assert.strictEqual(ccloudConnectionRow.status, "(No connection)");
        });
      });
    });

    it("getChildren", () => {
      ccloudConnectionRow.environments.push(TEST_CCLOUD_ENVIRONMENT);
      const children = ccloudConnectionRow.getChildren();
      assert.deepEqual(children, [TEST_CCLOUD_ENVIRONMENT]);
    });

    describe("refresh", () => {
      let getEnvironmentsStub: sinon.SinonStub;
      let getOrganizationStub: sinon.SinonStub;
      let hasCCloudAuthSessionStub: sinon.SinonStub;

      beforeEach(() => {
        getEnvironmentsStub = sandbox.stub(ccloudLoader, "getEnvironments");
        getOrganizationStub = sandbox.stub(ccloudLoader, "getOrganization");
        hasCCloudAuthSessionStub = sandbox.stub(ccloudConnections, "hasCCloudAuthSession");
      });

      describe("when not logged in", () => {
        beforeEach(() => {
          hasCCloudAuthSessionStub.returns(false);
          // smell like it used to be connected.
          ccloudConnectionRow.environments.push(TEST_CCLOUD_ENVIRONMENT);
          ccloudConnectionRow.ccloudOrganization = TEST_CCLOUD_ORGANIZATION;
        });

        it("makes no additional calls + reverts to empty state", async () => {
          await ccloudConnectionRow.refresh(false);
          sinon.assert.calledOnce(hasCCloudAuthSessionStub);
          sinon.assert.notCalled(getEnvironmentsStub);
          sinon.assert.notCalled(getOrganizationStub);

          assert.strictEqual(ccloudConnectionRow.environments.length, 0);
          assert.strictEqual(ccloudConnectionRow.ccloudOrganization, undefined);
          assert.strictEqual(ccloudConnectionRow.connected, false);
        });
      });

      describe("when logged in", () => {
        beforeEach(() => {
          hasCCloudAuthSessionStub.returns(true);
          getOrganizationStub.resolves(TEST_CCLOUD_ORGANIZATION);
          getEnvironmentsStub.resolves([TEST_CCLOUD_ENVIRONMENT]);
        });

        it("calls getEnvironments and getOrganization", async () => {
          await ccloudConnectionRow.refresh(false);

          sandbox.assert.calledOnce(getOrganizationStub);
          sandbox.assert.calledOnce(getEnvironmentsStub);
          assert.strictEqual(ccloudConnectionRow.ccloudOrganization, TEST_CCLOUD_ORGANIZATION);
          assert.strictEqual(ccloudConnectionRow.environments.length, 1);
        });

        it("handles error raised from getEnvironments", async () => {
          const showErrorNotificationWithButtonsStub = sandbox.stub(
            notifications,
            "showErrorNotificationWithButtons",
          );

          // set up to smell like had been previously connected, but this refresh fails.
          ccloudConnectionRow.environments.push(TEST_CCLOUD_ENVIRONMENT);
          ccloudConnectionRow.ccloudOrganization = TEST_CCLOUD_ORGANIZATION;

          const msg = "Test error message";
          getEnvironmentsStub.rejects(new Error(msg));

          await ccloudConnectionRow.refresh(false);

          // Should have notified the user of an error.
          sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);

          // Should have reverted to empty state.
          assert.strictEqual(ccloudConnectionRow.ccloudOrganization, undefined);
          assert.strictEqual(ccloudConnectionRow.environments.length, 0);
        });
      });
    });
  });

  describe("NewResourceViewProvider", () => {
    let provider: NewResourceViewProvider;

    beforeEach(() => {
      provider = new NewResourceViewProvider();

      // would have been called if we obtained through getInstance().
      provider["initialize"]();
    });

    afterEach(() => {
      provider.dispose();
    });

    describe("loadAndStoreConnection(), refreshConnection()", () => {
      let localConnectionRow: LocalConnectionRow;
      let rowRefreshStub: sinon.SinonStub;
      let repaintStub: sinon.SinonStub;

      beforeEach(async () => {
        // populate with local row only
        localConnectionRow = new LocalConnectionRow();
        rowRefreshStub = sandbox.stub(localConnectionRow, "refresh").resolves();
        repaintStub = sandbox.stub(provider as any, "repaint");
      });

      for (const insertBeforeRefresh of [true, false]) {
        it(`loadAndStoreConnection(connection, ${insertBeforeRefresh})`, async () => {
          await provider.loadAndStoreConnection(localConnectionRow, insertBeforeRefresh);

          sandbox.assert.calledOnce(rowRefreshStub);
          sandbox.assert.calledOnce(repaintStub);
        });
      }

      describe("refreshConnection()", async () => {
        let loggerWarnStub: sinon.SinonStub;

        beforeEach(() => {
          loggerWarnStub = sandbox.stub(provider.logger, "warn");
        });

        it("connection not found, logs warning and no repaint", async () => {
          const connectionId = "non-existent-connection-id" as ConnectionId;

          await provider.refreshConnection(connectionId);

          sinon.assert.calledOnce(loggerWarnStub);
          sinon.assert.calledWith(loggerWarnStub, "No connection row found for connectionId", {
            connectionId,
          });
          sinon.assert.notCalled(repaintStub);
        });

        it("connection found, calls its refresh(), then repaints", async () => {
          await provider.loadAndStoreConnection(localConnectionRow, true);
          // Both of these stubs are called during loadAndStoreConnection(), so reset.
          rowRefreshStub.resetHistory();
          repaintStub.resetHistory();

          // refresh a connection that exists.
          await provider.refreshConnection(LOCAL_CONNECTION_ID);

          sinon.assert.notCalled(loggerWarnStub);
          sinon.assert.calledOnce(rowRefreshStub);
          sinon.assert.calledOnce(repaintStub);
        });
      });
    });

    describe("ccloudConnectedEventHandler(), localConnectedEventHandler()", () => {
      let refreshConnectionStub: sinon.SinonStub;

      beforeEach(() => {
        refreshConnectionStub = sandbox.stub(provider, "refreshConnection");
      });

      it("Refreshes ccloud connection when ccloudConnectedEventHandler is called", async () => {
        await provider.ccloudConnectedEventHandler();
        sinon.assert.calledOnce(refreshConnectionStub);
        sinon.assert.calledWith(refreshConnectionStub, CCLOUD_CONNECTION_ID, true);
      });

      it("Refreshes local connection when localConnectedEventHandler is called", async () => {
        await provider.localConnectedEventHandler();
        sinon.assert.calledOnce(refreshConnectionStub);
        sinon.assert.calledWith(refreshConnectionStub, LOCAL_CONNECTION_ID, true);
      });
    });

    describe("reconcileDirectConnections()", () => {
      let resourceLoadersDirectLoadersStub: sinon.SinonStub;
      let providerLoadAndStoreConnectionStub: sinon.SinonStub;
      let providerRepaintStub: sinon.SinonStub;

      beforeEach(() => {
        // Set up so that we start with a provider that has no direct connections,
        // that will have been initialized with no direct loaders.

        resourceLoadersDirectLoadersStub = sandbox
          .stub(ResourceLoader, "directLoaders")
          .returns([]);

        providerLoadAndStoreConnectionStub = sandbox
          .stub(provider, "loadAndStoreConnection")
          .resolves();

        providerRepaintStub = sandbox.stub(provider as any, "repaint");
      });

      it("Adds new DirectResourceLoaders when needed", async () => {
        // Simulate a new one existing...
        const newDirectLoader = new DirectResourceLoader(
          "test-adds-direct-connection-row" as ConnectionId,
        );
        resourceLoadersDirectLoadersStub.returns([newDirectLoader]);

        await provider["reconcileDirectConnections"]();

        // Should have called this.loadAndStoreConnection() for the new direct connection.
        sinon.assert.calledOnce(providerLoadAndStoreConnectionStub);
        sinon.assert.calledWith(
          providerLoadAndStoreConnectionStub,
          sinon.match.instanceOf(DirectConnectionRow),
          false, // insertBeforeRefresh
        );
        // And should have refreshed the view.
        sinon.assert.calledOnce(providerRepaintStub);
      });

      it("Removes DirectConnectionRows that no longer have loaders", async () => {
        // For simplicity, remove all connection rows (ccloud, local) before
        // adding in a single DirectConnectionRow which should get removed
        // during reconciliation.
        // provider["connections"].clear();

        // Simulate a DirectResourceLoader that no longer exists.
        const deleted_id = "test-deleted-direct-connection-row" as ConnectionId;
        const removedDirectLoader = new DirectResourceLoader(deleted_id);

        provider["connections"].set(deleted_id, new DirectConnectionRow(removedDirectLoader));

        resourceLoadersDirectLoadersStub.returns([]);

        await provider["reconcileDirectConnections"]();

        // Should have removed the connection row for the removed loader.
        assert.strictEqual(provider["connections"].size, 0);
        // And repainted toplevel.
        sinon.assert.calledOnce(providerRepaintStub);
      });
    });

    describe("repaint()", () => {
      let onDidChangeTreeDataFireStub: sinon.SinonStub;

      beforeEach(() => {
        onDidChangeTreeDataFireStub = sandbox.stub(provider["_onDidChangeTreeData"], "fire");
      });

      it("toplevel repaint", () => {
        provider["repaint"]();
        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
        sinon.assert.calledWithExactly(onDidChangeTreeDataFireStub, undefined);
      });

      it("repaint a specific connection row", () => {
        const connectionId = "test-connection-id" as ConnectionId;
        const connectionRow = new DirectConnectionRow(new DirectResourceLoader(connectionId));
        provider["repaint"](connectionRow);
        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
        sinon.assert.calledWithExactly(onDidChangeTreeDataFireStub, connectionRow);
      });
    });

    describe("lazyInitializeConnections()", () => {
      let resourceLoadersDirectLoadersStub: sinon.SinonStub;
      let providerLoadAndStoreConnectionStub: sinon.SinonStub;

      beforeEach(() => {
        // Set up so that we start with a provider that has no direct connections,
        // that will have been initialized with no direct loaders.
        resourceLoadersDirectLoadersStub = sandbox
          .stub(ResourceLoader, "directLoaders")
          .returns([]);

        providerLoadAndStoreConnectionStub = sandbox
          .stub(provider, "loadAndStoreConnection")
          .resolves();
      });

      it("class loadAndStoreConnection for LocalConnectionRow, CCloudConnectionRow", async () => {
        await provider["lazyInitializeConnections"]();

        // Should have called this.loadAndStoreConnection() twice: once for LocalConnectionRow and once for CCloudConnectionRow.
        sinon.assert.calledTwice(providerLoadAndStoreConnectionStub);

        sinon.assert.calledWith(
          providerLoadAndStoreConnectionStub,
          sinon.match.instanceOf(LocalConnectionRow),
          true, // insertBeforeRefresh
        );

        sinon.assert.calledWith(
          providerLoadAndStoreConnectionStub,
          sinon.match.instanceOf(CCloudConnectionRow),
          true, // insertBeforeRefresh
        );
      });

      it("calls loadAndStoreConnection for each DirectResourceLoader", async () => {
        resourceLoadersDirectLoadersStub.returns([
          new DirectResourceLoader("test-direct-connection-id" as ConnectionId),
        ]);

        await provider["lazyInitializeConnections"]();

        // Should have called this.loadAndStoreConnection() for the new direct connection.
        // (as well as the implicit Local and CCloud rows).
        sinon.assert.calledThrice(providerLoadAndStoreConnectionStub);
        sinon.assert.calledWith(
          providerLoadAndStoreConnectionStub,
          sinon.match.instanceOf(DirectConnectionRow),
          false, // insertBeforeRefresh
        );
      });
    });

    describe("getChildren()", () => {
      let lazyInitializeConnectionsStub: sinon.SinonStub;

      beforeEach(() => {
        lazyInitializeConnectionsStub = sandbox
          .stub(provider as any, "lazyInitializeConnections")
          .resolves();
      });

      function setChildren(children: Array<AnyConnectionRow>) {
        // Set the connections directly, as if they were already loaded.
        provider["connections"].clear();
        for (const child of children) {
          provider["connections"].set(child.connectionId, child);
        }
      }

      function assignDefaultChildren(): Array<AnyConnectionRow> {
        const defaultChildren = [new LocalConnectionRow(), new CCloudConnectionRow()];

        setChildren(defaultChildren);
        return defaultChildren;
      }

      it("kicks off lazy initialization of connections when no existing children and called with undefined.", () => {
        const children = provider.getChildren(undefined);
        assert.strictEqual(children.length, 0); // no connections yet.
        sinon.assert.calledOnce(lazyInitializeConnectionsStub);
      });

      it("returns toplevel children when asked after lazy initialization has assigned", () => {
        const expectedChildren = assignDefaultChildren();

        const children = provider.getChildren(undefined);
        assert.deepStrictEqual(children, expectedChildren);
      });

      it("Returns children of a specific connection row", () => {
        assignDefaultChildren();
        const expectedLocalChildren = [TEST_LOCAL_KAFKA_CLUSTER, TEST_LOCAL_SCHEMA_REGISTRY];

        const localConnectionRow = new LocalConnectionRow();
        const localRowChildrenStub = sandbox
          .stub(localConnectionRow, "getChildren")
          .returns(expectedLocalChildren);

        const childrenOfRow = provider.getChildren(localConnectionRow);
        assert.deepStrictEqual(childrenOfRow, expectedLocalChildren);
        sinon.assert.calledOnce(localRowChildrenStub);
      });

      const TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_SR = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
        schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
      });

      const TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_SR_AND_FLINK = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
        schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
        flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      });

      for (const testCase of [
        {
          label: "returns empty array when no children in environment",
          environment: TEST_CCLOUD_ENVIRONMENT,
          expectedChildren: [],
        },
        {
          label: "returns Kafka clusters and Schema Registry when set",
          environment: TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_SR,
          expectedChildren: [TEST_CCLOUD_KAFKA_CLUSTER, TEST_CCLOUD_SCHEMA_REGISTRY],
        },
        {
          label: "returns Kafka clusters, Schema Registry and Flink Compute Pools when all set",
          environment: TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_SR_AND_FLINK,
          expectedChildren: [
            TEST_CCLOUD_KAFKA_CLUSTER,
            TEST_CCLOUD_SCHEMA_REGISTRY,
            TEST_CCLOUD_FLINK_COMPUTE_POOL,
          ],
        },
      ]) {
        it(`Returns proper children of a ccloud environment: ${testCase.label}`, () => {
          assignDefaultChildren();

          const children = provider.getChildren(testCase.environment);
          assert.deepStrictEqual(children, testCase.expectedChildren);
        });
      }

      for (const neverHasChildren of [
        TEST_CCLOUD_KAFKA_CLUSTER,
        TEST_CCLOUD_SCHEMA_REGISTRY,
        TEST_CCLOUD_FLINK_COMPUTE_POOL,
      ]) {
        it(`Returns empty array for objects which should never have children: ${neverHasChildren.name}`, () => {
          assignDefaultChildren();

          const children = provider.getChildren(neverHasChildren);
          assert.deepStrictEqual(children, []);
        });
      }

      it("Raises error when called with an unsupported element type", () => {
        assignDefaultChildren();

        assert.throws(() => {
          provider.getChildren({} as any);
        }, /Unhandled element/);
      });
    });

    describe("sortConnections()", () => {
      it("sorts ccloud first, then local, then direct connections by name", () => {
        const ccloudConnectionRow = new CCloudConnectionRow();
        const localConnectionRow = new LocalConnectionRow();
        const directConnectionRowA = new DirectConnectionRow(
          new DirectResourceLoader("test-direct-connection-A" as ConnectionId),
        );
        sandbox.stub(directConnectionRowA, "name").get(() => "A Direct Connection");

        const directConnectionRowB = new DirectConnectionRow(
          new DirectResourceLoader("test-direct-connection-B" as ConnectionId),
        );
        sandbox.stub(directConnectionRowB, "name").get(() => "B Direct Connection");

        // Initially in opposite order.
        const connections = [
          directConnectionRowB,
          directConnectionRowA,
          localConnectionRow,
          ccloudConnectionRow,
        ];

        provider["sortConnections"](connections);
        assert.deepStrictEqual(
          connections,
          [ccloudConnectionRow, localConnectionRow, directConnectionRowA, directConnectionRowB],
          "Connections should be sorted by type and name",
        );
      });
    });

    describe("getTreeItem()", () => {
      for (const testCase of [
        {
          label: "ConnectionRow",
          element: new LocalConnectionRow(),
          expectedType: TreeItem, // a ConnectionRow's getTreeItem() returns a bare TreeItem.
        },
        {
          label: "CCloudEnvironent",
          element: TEST_CCLOUD_ENVIRONMENT,
          expectedType: EnvironmentTreeItem,
        },
        {
          label: "LocalKafkaCluster",
          element: TEST_LOCAL_KAFKA_CLUSTER,
          expectedType: KafkaClusterTreeItem,
        },
        {
          label: "CCloudSchemaRegistry",
          element: TEST_CCLOUD_SCHEMA_REGISTRY,
          expectedType: SchemaRegistryTreeItem,
        },
        {
          label: "FlinkComputePool",
          element: TEST_CCLOUD_FLINK_COMPUTE_POOL,
          expectedType: FlinkComputePoolTreeItem,
        },
      ]) {
        it(`returns TreeItem for ${testCase.label}`, () => {
          const treeItem = provider.getTreeItem(testCase.element);
          assert.ok(treeItem instanceof testCase.expectedType);
        });
      }

      it("throws when called with an unsupported element type", () => {
        assert.throws(() => {
          provider.getTreeItem({} as any);
        }, /Unhandled element/);
      });
    });
  });

  describe("mergeUpdates()", () => {
    it("Updates original array with new and updated items", () => {
      const localEnvUpdateStub = sandbox.stub(TEST_LOCAL_ENVIRONMENT, "update");
      const original = [TEST_LOCAL_ENVIRONMENT];
      const updates = [TEST_LOCAL_ENVIRONMENT, TEST_CCLOUD_ENVIRONMENT];

      // Updates original in place.
      mergeUpdates(original, updates);

      assert.strictEqual(original.length, 2);
      assert.strictEqual(original[0], TEST_LOCAL_ENVIRONMENT);
      assert.strictEqual(original[1], TEST_CCLOUD_ENVIRONMENT);
      sinon.assert.calledOnce(localEnvUpdateStub); // got called to update itself given reference to same id element in new array.
      sinon.assert.calledWithExactly(localEnvUpdateStub, TEST_LOCAL_ENVIRONMENT);
    });
    it("Removes from original array any items not found in the new array", () => {
      const original = [TEST_LOCAL_ENVIRONMENT, TEST_CCLOUD_ENVIRONMENT];
      const updates = [original[0]]; // keep first.

      // Updates original in place.
      mergeUpdates(original, updates);

      assert.strictEqual(original.length, 1);
      assert.strictEqual(original[0], TEST_LOCAL_ENVIRONMENT);
    });
  });
});
