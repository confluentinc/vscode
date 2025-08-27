import * as assert from "assert";
import sinon from "sinon";
import { ConfigurationChangeEvent, workspace } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as contextValues from "../context/values";
import { ExtensionSetting } from "./base";
import {
  CCLOUD_PRIVATE_NETWORK_ENDPOINTS,
  ENABLE_CHAT_PARTICIPANT,
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

    assert.ok(updatePreferencesStub.notCalled);
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

        assert.ok(setContextValueStub.calledWith(previewContextValue, enabled));
      });
    }
  }
});
