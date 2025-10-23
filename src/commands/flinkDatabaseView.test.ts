import * as sinon from "sinon";

import * as indexModule from ".";
import {
  registerFlinkDatabaseViewCommands,
  setFlinkArtifactsViewModeCommand,
  setFlinkRelationsViewModeCommand,
  setFlinkUDFViewModeCommand,
} from "./flinkDatabaseView";

import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
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

    it("should register the expected commands", () => {
      registerFlinkDatabaseViewCommands();

      sinon.assert.calledWith(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.setRelationsViewMode",
        setFlinkRelationsViewModeCommand,
      );

      sinon.assert.calledWith(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.setUDFsViewMode",
        setFlinkUDFViewModeCommand,
      );

      sinon.assert.calledWith(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.setArtifactsViewMode",
        setFlinkArtifactsViewModeCommand,
      );
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
});
