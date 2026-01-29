import * as assert from "assert";
import sinon from "sinon";
import type { ConfigurationChangeEvent } from "vscode";
import { workspace } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as contextValues from "../context/values";
import { FlinkLanguageClientManager } from "../flinkSql/flinkLanguageClientManager";
import * as telemetryEvents from "../telemetry/events";
import type { ExtensionSetting } from "./base";
import { ENABLE_CHAT_PARTICIPANT, ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER } from "./constants";
import { createConfigChangeListener } from "./listener";

describe("extensionSettings/listener.ts", function () {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;
  let onDidChangeConfigurationStub: sinon.SinonStub;
  let logUsageStub: sinon.SinonStub;

  let setContextValueStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // stub the WorkspaceConfiguration and onDidChangeConfiguration emitter
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    onDidChangeConfigurationStub = sandbox.stub(workspace, "onDidChangeConfiguration");
    setContextValueStub = sandbox.stub(contextValues, "setContextValue");
    logUsageStub = sandbox.stub(telemetryEvents, "logUsage").returns();
  });

  afterEach(function () {
    sandbox.restore();
  });

  const previewSettings: [ExtensionSetting<any>, contextValues.ContextValues][] = [
    [ENABLE_CHAT_PARTICIPANT, contextValues.ContextValues.chatParticipantEnabled],
  ];
  for (const [previewSetting, previewContextValue] of previewSettings) {
    for (const enabled of [true, false]) {
      it(`should update the "${previewContextValue}" context value when the "${previewSetting.id}" setting is changed to ${enabled} (REMOVE ONCE PREVIEW SETTING IS NO LONGER USED)`, async () => {
        stubbedConfigs.stubGet(previewSetting, enabled);
        const mockEvent = {
          affectsConfiguration: (config: string) => config === previewSetting.id,
        } as ConfigurationChangeEvent;
        onDidChangeConfigurationStub.yields(mockEvent);

        createConfigChangeListener();
        // simulate the setting being changed by the user
        await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

        sinon.assert.calledWith(setContextValueStub, previewContextValue, enabled);
      });
    }
  }

  it(`should dispose the FlinkLanguageClientManager when "${ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id}" is set to false`, async () => {
    stubbedConfigs.stubGet(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER, false);
    const stubbedFlinkLanguageClientManager = sandbox.createStubInstance(
      FlinkLanguageClientManager,
    );
    sandbox
      .stub(FlinkLanguageClientManager, "getInstance")
      .returns(stubbedFlinkLanguageClientManager);

    const mockEvent = {
      affectsConfiguration: (config: string) => config === ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    sinon.assert.called(stubbedFlinkLanguageClientManager.dispose);
    sinon.assert.calledWith(logUsageStub, telemetryEvents.UserEvent.ExtensionSettingsChange, {
      settingId: ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id,
      enabled: false,
    });
  });

  it(`should have an active FlinkLanguageClientManager instance when "${ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id}" is set to true`, async () => {
    stubbedConfigs.stubGet(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER, true);
    FlinkLanguageClientManager["instance"] = null;

    const mockEvent = {
      affectsConfiguration: (config: string) => config === ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    // makes sure FlinkLanguageClientManager has started
    assert.ok(FlinkLanguageClientManager["instance"]);
    sinon.assert.calledWith(logUsageStub, telemetryEvents.UserEvent.ExtensionSettingsChange, {
      settingId: ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id,
      enabled: true,
    });
  });
});
