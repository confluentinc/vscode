import * as sinon from "sinon";

import * as indexModule from ".";
import * as kafkaClusterCommandsModule from "./kafkaClusters";

import {
  createTopicInFlinkDatabaseViewCommand,
  registerFlinkDatabaseViewCommands,
  setFlinkArtifactsViewModeCommand,
  setFlinkRelationsViewModeCommand,
  setFlinkUDFViewModeCommand,
} from "./flinkDatabaseView";

import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as sidecarUtilsModule from "../sidecar/utils";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

describe("commands/flinkDatabaseView.ts", () => {
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

  describe("registerFlinkDatabaseViewCommands", () => {
    let registerCommandWithLoggingStub: sinon.SinonStub;

    beforeEach(() => {
      registerCommandWithLoggingStub = sandbox.stub(indexModule, "registerCommandWithLogging");
    });

    it("should register the expected commands", () => {
      const commandNameAndFunctionPairs: [string, () => Promise<void>][] = [
        ["confluent.flinkdatabase.setRelationsViewMode", setFlinkRelationsViewModeCommand],
        ["confluent.flinkdatabase.setUDFsViewMode", setFlinkUDFViewModeCommand],
        ["confluent.flinkdatabase.setArtifactsViewMode", setFlinkArtifactsViewModeCommand],
        ["confluent.flinkdatabase.createTopic", createTopicInFlinkDatabaseViewCommand],
      ];

      commandNameAndFunctionPairs.forEach(([commandName, commandFunction]) => {
        it(`should register the ${commandName} command`, () => {
          registerFlinkDatabaseViewCommands();
          sinon.assert.calledWithExactly(
            registerCommandWithLoggingStub,
            commandName,
            commandFunction,
          );
        });
      });
    });

    describe("mode switching commands", () => {
      let provider: FlinkDatabaseViewProvider;
      let switchModeStub: sinon.SinonStub;

      beforeEach(() => {
        provider = FlinkDatabaseViewProvider.getInstance();
        // switchMode itself is tested in the multiViewProvider tests, so we just stub it here
        switchModeStub = sandbox.stub(provider, "switchMode").resolves();
      });

      interface ModeTestCase {
        name: string;
        execute: () => Promise<void>;
        expectedMode: FlinkDatabaseViewProviderMode;
      }

      const testCases: readonly ModeTestCase[] = [
        {
          name: "setFlinkUDFViewModeCommand",
          execute: setFlinkUDFViewModeCommand,
          expectedMode: FlinkDatabaseViewProviderMode.UDFs,
        },
        {
          name: "setFlinkRelationsViewModeCommand",
          execute: setFlinkRelationsViewModeCommand,
          expectedMode: FlinkDatabaseViewProviderMode.Relations,
        },
        {
          name: "setFlinkArtifactsViewModeCommand",
          execute: setFlinkArtifactsViewModeCommand,
          expectedMode: FlinkDatabaseViewProviderMode.Artifacts,
        },
      ];

      for (const { name, execute, expectedMode } of testCases) {
        it(name, async () => {
          await execute();
          sinon.assert.calledOnceWithExactly(switchModeStub, expectedMode);
        });
      }
    });

    describe("createTopicInFlinkDatabaseViewCommand", () => {
      let flinkDatabaseViewProviderInstance: FlinkDatabaseViewProvider;
      let flinkDatabaseViewProviderGetInstanceStub: sinon.SinonStub;
      let createTopicCommandStub: sinon.SinonStub;
      let refreshStub: sinon.SinonStub;
      let hasChildrenStub: sinon.SinonStub;
      let pauseStub: sinon.SinonStub;

      beforeEach(() => {
        flinkDatabaseViewProviderInstance = new FlinkDatabaseViewProvider();
        flinkDatabaseViewProviderGetInstanceStub = sandbox.stub(
          FlinkDatabaseViewProvider,
          "getInstance",
        );
        flinkDatabaseViewProviderGetInstanceStub.returns(flinkDatabaseViewProviderInstance);
        createTopicCommandStub = sandbox.stub(kafkaClusterCommandsModule, "createTopicCommand");
        refreshStub = sandbox.stub(flinkDatabaseViewProviderInstance, "refresh").resolves();
        hasChildrenStub = sandbox.stub(flinkDatabaseViewProviderInstance, "hasChildren");
        pauseStub = sandbox.stub(sidecarUtilsModule, "pause").resolves();
      });

      afterEach(() => {
        flinkDatabaseViewProviderInstance.dispose();
      });

      it("should bail early if no Flink database is selected", async () => {
        // Mock no selected Flink database
        sinon.stub(flinkDatabaseViewProviderInstance, "database").get(() => undefined);
        await createTopicInFlinkDatabaseViewCommand();

        sinon.assert.notCalled(createTopicCommandStub);
      });

      it("should start to create a topic in the selected Flink database's Kafka cluster", async () => {
        // Mock a selected Flink database
        sinon
          .stub(flinkDatabaseViewProviderInstance, "database")
          .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

        // Have the stubbed command indicate that user skipped out of topic creation.
        createTopicCommandStub.resolves(false);

        await createTopicInFlinkDatabaseViewCommand();

        sinon.assert.calledOnceWithExactly(
          createTopicCommandStub,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        );

        // Should not attempt to refresh the view if no topic was created.
        sinon.assert.notCalled(refreshStub);
      });

      it("should refresh the Flink Database view after topic creation", async () => {
        // Mock a selected Flink database
        sinon
          .stub(flinkDatabaseViewProviderInstance, "database")
          .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

        // Have the stubbed command indicate that a topic was created.
        createTopicCommandStub.resolves(true);

        // Simulate that the view has no children initially, then has children after refresh.
        hasChildrenStub.onFirstCall().returns(false);
        hasChildrenStub.onSecondCall().returns(true);
        hasChildrenStub.onThirdCall().returns(true);

        await createTopicInFlinkDatabaseViewCommand();

        sinon.assert.calledOnceWithExactly(
          createTopicCommandStub,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        );

        // Only took one refresh to get children.
        sinon.assert.calledOnce(refreshStub);
        sinon.assert.calledOnce(pauseStub);

        // Deep refreshes.
        sinon.assert.calledWithExactly(refreshStub.firstCall, true);

        // twice in the loop, then once more after exiting the loop.
        sinon.assert.calledThrice(hasChildrenStub);
      });

      it("should fail gracefully if Flink Database view has no children after several refresh attempts", async () => {
        // Mock a selected Flink database
        sinon
          .stub(flinkDatabaseViewProviderInstance, "database")
          .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

        // Have the stubbed command indicate that a topic was created.
        createTopicCommandStub.resolves(true);
        // but the view never gets any children.
        hasChildrenStub.returns(false);

        await createTopicInFlinkDatabaseViewCommand();

        sinon.assert.called(refreshStub);
        sinon.assert.callCount(refreshStub, 5); // 5 attempts in the loop then bailed.
      });
    });
  });
});
