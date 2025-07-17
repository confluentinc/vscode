import * as assert from "assert";
import sinon from "sinon";
import { ConfigurationChangeEvent, workspace } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as contextValues from "../context/values";
import { FlinkLanguageClientManager } from "../flinkSql/flinkLanguageClientManager";
import * as telemetryEvents from "../telemetry/events";
import {
  ENABLE_CHAT_PARTICIPANT,
  ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import { createConfigChangeListener } from "./listener";
import * as updates from "./sidecarSync";

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

  it(`should call updatePreferences() when the "${SSL_PEM_PATHS.id}" setting changes`, async function () {
    stubbedConfigs.get.withArgs(SSL_PEM_PATHS.id).returns(["path/to/pem"]);
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences").resolves();

    const mockEvent = {
      affectsConfiguration: (config: string) => config === SSL_PEM_PATHS.id,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    sinon.assert.called(updatePreferencesStub);
  });

  it(`should call updatePreferences() when the "${SSL_VERIFY_SERVER_CERT_DISABLED.id}" setting changes`, async function () {
    stubbedConfigs.get.withArgs(SSL_VERIFY_SERVER_CERT_DISABLED.id).returns(true);
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences").resolves();

    const mockEvent = {
      affectsConfiguration: (config: string) => config === SSL_VERIFY_SERVER_CERT_DISABLED.id,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    sinon.assert.called(updatePreferencesStub);
  });

  it(`should not call updatePreferences() if config change does not affect "${SSL_PEM_PATHS.id}" or "${SSL_VERIFY_SERVER_CERT_DISABLED.id}"`, async function () {
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences");

    const mockEvent = {
      affectsConfiguration: (config: string) => config === "some.other.config",
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    assert.ok(updatePreferencesStub.notCalled);
  });

  for (const [previewSetting, previewContextValue] of [
    [ENABLE_CHAT_PARTICIPANT.id, contextValues.ContextValues.chatParticipantEnabled],
  ]) {
    for (const enabled of [true, false]) {
      it(`should update the "${previewContextValue}" context value when the "${previewSetting}" setting is changed to ${enabled} (REMOVE ONCE PREVIEW SETTING IS NO LONGER USED)`, async () => {
        stubbedConfigs.get.withArgs(previewSetting).returns(enabled);
        const mockEvent = {
          affectsConfiguration: (config: string) => config === previewSetting,
        } as ConfigurationChangeEvent;
        onDidChangeConfigurationStub.yields(mockEvent);

        createConfigChangeListener();
        // simulate the setting being changed by the user
        await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

        assert.ok(setContextValueStub.calledWith(previewContextValue, enabled));
      });
    }
  }

  for (const configValue of [false, null, undefined]) {
    it(`should dispose the FlinkLanguageClientManager when "${ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id}" is set to ${configValue}`, async () => {
      stubbedConfigs.get
        .withArgs(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id, configValue)
        .returns(configValue);
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
  }

  it(`should call maybeStartLanguageClient() when "${ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id}" is set to true`, async () => {
    stubbedConfigs.get.withArgs(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id).returns(true);
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

    sinon.assert.called(stubbedFlinkLanguageClientManager.maybeStartLanguageClient);
    sinon.assert.calledWith(logUsageStub, telemetryEvents.UserEvent.ExtensionSettingsChange, {
      settingId: ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id,
      enabled: true,
    });
  });
});
