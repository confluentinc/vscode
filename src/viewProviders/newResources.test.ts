import * as assert from "assert";
import sinon from "sinon";
import { MarkdownString } from "vscode";
import * as environmentModels from "../../src/models/environment";
import * as sidecarLocalConnections from "../../src/sidecar/connections/local";
import {
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_ENVIRONMENT,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ConnectionType } from "../clients/sidecar/models/ConnectionType";
import { IconNames } from "../constants";
import { DirectResourceLoader, LocalResourceLoader } from "../loaders";
import { DirectEnvironment, LocalEnvironment } from "../models/environment";
import { ConnectionId } from "../models/resource";
import { ConnectionStateWatcher } from "../sidecar/connections/watcher";
import {
  DirectConnectionRow,
  LocalConnectionRow,
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

        for (const deepRefresh of [false, true]) {
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
      });

      describe("getEnvironments", () => {
        let loaderGetEnvironmentsStub: sinon.SinonStub;

        beforeEach(() => {
          loaderGetEnvironmentsStub = sandbox.stub(directLoader, "getEnvironments").resolves([]);
        });

        it("calls loader.getEnvironments with deepRefresh=false", async () => {
          await directConnectionRow.getEnvironments();
          sinon.assert.calledOnceWithExactly(loaderGetEnvironmentsStub, false);
        });

        it("returns the environments from the loader", async () => {
          const expectedEnvironments = [TEST_DIRECT_ENVIRONMENT_WITH_KAFKA_AND_SR];
          loaderGetEnvironmentsStub.resolves(expectedEnvironments);
          const environments = await directConnectionRow.getEnvironments();
          assert.deepStrictEqual(environments, expectedEnvironments);
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

      // TEST_LOCAL_ENVIRONMENT doesn't have Kafka or Schema Registry configured,
      // so we create a new one with those properties set.
      const LOCAL_ENVIRONMENT_WITH_KAFKA_AND_SR = new LocalEnvironment({
        ...TEST_LOCAL_ENVIRONMENT,
        kafkaClusters: [TEST_LOCAL_KAFKA_CLUSTER],
        schemaRegistry: TEST_LOCAL_SCHEMA_REGISTRY,
      });

      // ... and with a fully fleshed out connection
      localConnectionRow.environments.push(LOCAL_ENVIRONMENT_WITH_KAFKA_AND_SR);
      assert.strictEqual(
        localConnectionRow.status,
        LOCAL_ENVIRONMENT_WITH_KAFKA_AND_SR.kafkaClusters[0].uri!,
      );
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
        await localConnectionRow.refresh();
        assert.ok(updateLocalConnectionStub.calledOnce);
        assert.equal(localConnectionRow["needUpdateLocalConnection"], false);
      });

      it("downcalls into SingleEnvironmentConnectionRow.refresh", async () => {
        await localConnectionRow.refresh();
        sinon.assert.calledOnce(singleEnvironmentConnectionRowRefresh);
      });
    });
  });
});
