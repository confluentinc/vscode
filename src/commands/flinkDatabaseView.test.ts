import * as sinon from "sinon";

import * as indexModule from ".";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import * as kafkaClusterCommandsModule from "./kafkaClusters";

import {
  createTopicInFlinkDatabaseViewCommand,
  registerFlinkDatabaseViewCommands,
  setFlinkRelationsViewModeCommand,
} from "./flinkDatabaseView";

import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import * as contextValuesModule from "../context/values";
import * as emittersModule from "../emitters";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

describe("commands/flinkDatabaseView.ts", () => {
  let sandbox: sinon.SinonSandbox;

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

    const commandNameAndFunctionPairs: [string, () => Promise<void>][] = [
      ["confluent.flinkdatabase.setRelationsViewMode", setFlinkRelationsViewModeCommand],
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

  describe("setFlinkRelationsViewModeCommand", () => {
    let flinkDatabaseViewModeFireStub: sinon.SinonStub;
    let setContextValueStub: sinon.SinonStub;

    beforeEach(() => {
      flinkDatabaseViewModeFireStub = sandbox.stub(emittersModule.flinkDatabaseViewMode, "fire");
      setContextValueStub = sandbox.stub(contextValuesModule, "setContextValue");
    });

    it("should set the Flink Database View mode to Relations and update the context value", async () => {
      await setFlinkRelationsViewModeCommand();

      sinon.assert.calledOnceWithExactly(
        flinkDatabaseViewModeFireStub,
        FlinkDatabaseViewProviderMode.Relations,
      );

      sinon.assert.calledOnceWithExactly(
        setContextValueStub,
        contextValuesModule.ContextValues.flinkDatabaseViewMode,
        FlinkDatabaseViewProviderMode.Relations,
      );
    });
  });

  describe("createTopicInFlinkDatabaseViewCommand", () => {
    let flinkDatabaseViewProviderInstance: FlinkDatabaseViewProvider;
    let flinkDatabaseViewProviderGetInstanceStub: sinon.SinonStub;
    let createTopicCommandStub: sinon.SinonStub;

    beforeEach(() => {
      flinkDatabaseViewProviderInstance = new FlinkDatabaseViewProvider();
      flinkDatabaseViewProviderGetInstanceStub = sandbox.stub(
        FlinkDatabaseViewProvider,
        "getInstance",
      );
      flinkDatabaseViewProviderGetInstanceStub.returns(flinkDatabaseViewProviderInstance);
      createTopicCommandStub = sandbox.stub(kafkaClusterCommandsModule, "createTopicCommand");
    });

    afterEach(() => {
      flinkDatabaseViewProviderInstance.dispose();
    });

    it("should start to create a topic in the selected Flink database's Kafka cluster", async () => {
      // Mock a selected Flink database
      sinon
        .stub(flinkDatabaseViewProviderInstance, "database")
        .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
      await createTopicInFlinkDatabaseViewCommand();

      sinon.assert.calledOnceWithExactly(
        createTopicCommandStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      );
    });

    it("should bail early Flink database is selected", async () => {
      // Mock no selected Flink database
      sinon.stub(flinkDatabaseViewProviderInstance, "database").get(() => undefined);
      await createTopicInFlinkDatabaseViewCommand();

      sinon.assert.notCalled(createTopicCommandStub);
    });
  });
});
