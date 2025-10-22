import * as sinon from "sinon";

import * as indexModule from ".";
import {
  registerFlinkDatabaseViewCommands,
  setFlinkRelationsViewModeCommand,
} from "./flinkDatabaseView";

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
      registerCommandWithLoggingStub = sinon.stub(indexModule, "registerCommandWithLogging");
    });

    it("should register the setFlinkRelationsViewModeCommand command", () => {
      registerFlinkDatabaseViewCommands();

      sinon.assert.calledOnce(registerCommandWithLoggingStub);
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.setRelationsViewMode",
        setFlinkRelationsViewModeCommand,
      );
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
});
