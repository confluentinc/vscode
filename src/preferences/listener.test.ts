import * as assert from "assert";
import sinon from "sinon";
import { ConfigurationChangeEvent, workspace } from "vscode";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as contextValues from "../context/values";
import {
  ENABLE_DIRECT_CONNECTIONS,
  ENABLE_PRODUCE_MESSAGES,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import { createConfigChangeListener } from "./listener";
import * as updates from "./updates";

describe("preferences/listener", function () {
  let sandbox: sinon.SinonSandbox;
  let getConfigurationStub: sinon.SinonStub;
  let onDidChangeConfigurationStub: sinon.SinonStub;
  let setContextValueStub: sinon.SinonStub;

  before(async () => {
    // ResourceViewProvider interactions require the extension context to be set (used during changes
    // in the direct connection preview setting)
    await getTestExtensionContext();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // stub the WorkspaceConfiguration and onDidChangeConfiguration emitter
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    onDidChangeConfigurationStub = sandbox.stub(workspace, "onDidChangeConfiguration");
    setContextValueStub = sandbox.stub(contextValues, "setContextValue");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should call updatePreferences() with 'tls_pem_paths' when the SSL_PEM_PATHS config changes", async function () {
    const mockConfig = {
      get: sandbox.stub().withArgs(SSL_PEM_PATHS).returns(["path/to/pem"]),
    };
    getConfigurationStub.returns(mockConfig);
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences").resolves();

    const mockEvent = {
      affectsConfiguration: (config: string) => config === SSL_PEM_PATHS,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    assert.ok(updatePreferencesStub.calledWith({ tls_pem_paths: ["path/to/pem"] }));
  });

  it("should call updatePreferences() with 'trust_all_certificates' when the SSL_VERIFY_SERVER_CERT_DISABLED config changes", async function () {
    const mockConfig = {
      get: sandbox.stub().withArgs(SSL_VERIFY_SERVER_CERT_DISABLED).returns(true),
    };
    getConfigurationStub.returns(mockConfig);
    const updatePreferencesStub = sandbox.stub(updates, "updatePreferences").resolves();

    const mockEvent = {
      affectsConfiguration: (config: string) => config === SSL_VERIFY_SERVER_CERT_DISABLED,
    } as ConfigurationChangeEvent;
    onDidChangeConfigurationStub.yields(mockEvent);

    createConfigChangeListener();
    await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

    assert.ok(updatePreferencesStub.calledWith({ trust_all_certificates: true }));
  });

  it("should not call updatePreferences() if config change does not affect SSL_PEM_PATHS or SSL_VERIFY_SERVER_CERT_DISABLED", async function () {
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
    [ENABLE_DIRECT_CONNECTIONS, contextValues.ContextValues.directConnectionsEnabled],
    [ENABLE_PRODUCE_MESSAGES, contextValues.ContextValues.produceMessagesEnabled],
  ]) {
    for (const enabled of [true, false]) {
      it(`should update the "${previewContextValue}" context value when the "${previewSetting}" setting is changed to ${enabled} (REMOVE ONCE PREVIEW SETTING IS NO LONGER USED)`, async () => {
        getConfigurationStub.returns({
          get: sandbox.stub().withArgs(previewSetting).returns(enabled),
        });
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
});
