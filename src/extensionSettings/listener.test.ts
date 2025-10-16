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
import {
  CCLOUD_PRIVATE_NETWORK_ENDPOINTS,
  ENABLE_CHAT_PARTICIPANT,
  ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER,
  KRB5_CONFIG_PATH,
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
    stubbedConfigs.stubGet(SSL_PEM_PATHS, ["path/to/pem"]);
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
    stubbedConfigs.stubGet(SSL_VERIFY_SERVER_CERT_DISABLED, true);
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences").resolves();

    const mockEvent = {
      affectsConfiguration: (config: string) => config === SSL_VERIFY_SERVER_CERT_DISABLED.id,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    sinon.assert.called(updatePreferencesStub);
  });

  it(`should call updatePreferences() when the "${KRB5_CONFIG_PATH.id}" setting changes`, async function () {
    stubbedConfigs.stubGet(KRB5_CONFIG_PATH, "path/to/krb5.conf");
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences").resolves();

    const mockEvent = {
      affectsConfiguration: (config: string) => config === KRB5_CONFIG_PATH.id,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    sinon.assert.called(updatePreferencesStub);
  });

  it(`should call updatePreferences() when the "${CCLOUD_PRIVATE_NETWORK_ENDPOINTS.id}" setting changes`, async function () {
    stubbedConfigs.stubGet(CCLOUD_PRIVATE_NETWORK_ENDPOINTS, { env1: "endpoint1" });
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences").resolves();

    const mockEvent = {
      affectsConfiguration: (config: string) => config === CCLOUD_PRIVATE_NETWORK_ENDPOINTS.id,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    sinon.assert.called(updatePreferencesStub);
  });

  it(`should not call updatePreferences() if a config change does not affect a preferences API related setting"`, async function () {
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences");

    const mockEvent = {
      affectsConfiguration: (config: string) => config === "some.other.config",
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    sinon.assert.notCalled(updatePreferencesStub);
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
