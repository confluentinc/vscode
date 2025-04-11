import * as assert from "assert";
import * as sinon from "sinon";
import { workspace } from "vscode";
import {
  Preferences,
  PreferencesResourceApi,
  PreferencesSpec,
  ResponseError,
} from "../clients/sidecar";
import * as errors from "../errors";
import * as sidecar from "../sidecar";
import {
  DEFAULT_SSL_PEM_PATHS,
  DEFAULT_TRUST_ALL_CERTIFICATES,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import * as updates from "./updates";
import { loadPreferencesFromWorkspaceConfig } from "./updates";

describe("preferences/updates", function () {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<PreferencesResourceApi>;
  let getConfigurationStub: sinon.SinonStub;
  let logErrorStub: sinon.SinonStub;
  let showErrorNotificationWithButtonsStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    logErrorStub = sandbox.stub(errors, "logError");

    // create the stubs for the sidecar + service client
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    mockClient = sandbox.createStubInstance(PreferencesResourceApi);
    mockSidecarHandle.getPreferencesApi.returns(mockClient);
    // stub the getSidecar function to return the mock sidecar handle
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

    // stub the WorkspaceConfiguration
    getConfigurationStub = sandbox.stub();
    sandbox.stub(workspace, "getConfiguration").returns({
      get: getConfigurationStub,
      has: sandbox.stub(),
      update: sandbox.stub(),
      inspect: sandbox.stub(),
    });

    // stub the notifications
    showErrorNotificationWithButtonsStub = sandbox.stub(errors, "showErrorNotificationWithButtons");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("loadDefaultPreferences() should load default preferences from the workspace configuration", async function () {
    // default values, no user changes
    const tlsPemPaths: string[] = DEFAULT_SSL_PEM_PATHS;
    const trustAllCerts = DEFAULT_TRUST_ALL_CERTIFICATES;

    getConfigurationStub.withArgs(SSL_PEM_PATHS, DEFAULT_SSL_PEM_PATHS).returns(tlsPemPaths);
    getConfigurationStub
      .withArgs(SSL_VERIFY_SERVER_CERT_DISABLED, DEFAULT_TRUST_ALL_CERTIFICATES)
      .returns(trustAllCerts);

    const result: PreferencesSpec = loadPreferencesFromWorkspaceConfig();

    assert.deepStrictEqual(result, {
      tls_pem_paths: DEFAULT_SSL_PEM_PATHS,
      trust_all_certificates: DEFAULT_TRUST_ALL_CERTIFICATES,
    });
  });

  it("loadDefaultPreferences() should load preferences with custom values", async function () {
    // simulate user changing from the default values
    const tlsPemPaths: string[] = ["path/to/custom.pem"];
    const trustAllCerts = true;

    getConfigurationStub.withArgs(SSL_PEM_PATHS, DEFAULT_SSL_PEM_PATHS).returns(tlsPemPaths);
    getConfigurationStub
      .withArgs(SSL_VERIFY_SERVER_CERT_DISABLED, DEFAULT_TRUST_ALL_CERTIFICATES)
      .returns(trustAllCerts);

    const result: PreferencesSpec = loadPreferencesFromWorkspaceConfig();

    assert.deepStrictEqual(result, {
      tls_pem_paths: tlsPemPaths,
      trust_all_certificates: trustAllCerts,
    });
  });

  it("updatePreferences() should update preferences successfully based on workspace configs", async function () {
    // simulate user changing from the default values
    const tlsPemPaths: string[] = ["path/to/custom.pem"];
    const trustAllCerts = true;

    getConfigurationStub.withArgs(SSL_PEM_PATHS, DEFAULT_SSL_PEM_PATHS).returns(tlsPemPaths);
    getConfigurationStub
      .withArgs(SSL_VERIFY_SERVER_CERT_DISABLED, DEFAULT_TRUST_ALL_CERTIFICATES)
      .returns(trustAllCerts);

    const fakePreferences: Preferences = {
      api_version: "gateway/v1",
      kind: "Preferences",
      spec: {
        tls_pem_paths: tlsPemPaths,
        trust_all_certificates: trustAllCerts,
      },
    };
    mockClient.gatewayV1PreferencesPut.resolves(fakePreferences);

    await updates.updatePreferences();

    sinon.assert.calledWithExactly(mockClient.gatewayV1PreferencesPut, {
      Preferences: fakePreferences,
    });
    sinon.assert.notCalled(logErrorStub);
    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });

  it("updatePreferences() should log and not re-throw errors when updating preferences", async function () {
    const errorMessage = "Failed to update preferences";
    const error = new Error(errorMessage);
    mockClient.gatewayV1PreferencesPut.rejects(error);

    await updates.updatePreferences();

    sinon.assert.calledOnce(mockClient.gatewayV1PreferencesPut);
    sinon.assert.calledWithExactly(
      logErrorStub,
      sinon.match.instanceOf(Error).and(sinon.match.has("message", errorMessage)),
      "updating preferences",
      { extra: { functionName: "updatePreferences" } },
    );
    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    const callArgs = showErrorNotificationWithButtonsStub.getCall(0).args;
    assert.strictEqual(callArgs[0], `Failed to sync settings: ${errorMessage}`);
  });

  it("updatePreferences() should show an error notification when an Error is caught", async function () {
    const error = new Error("uh oh");
    mockClient.gatewayV1PreferencesPut.rejects(error);

    await updates.updatePreferences();

    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWithExactly(
      logErrorStub,
      sinon.match.instanceOf(Error).and(sinon.match.has("message", error.message)),
      "updating preferences",
      { extra: { functionName: "updatePreferences" } },
    );

    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    const callArgs = showErrorNotificationWithButtonsStub.getCall(0).args;
    assert.strictEqual(callArgs[0], `Failed to sync settings: ${error.message}`);
  });

  it("updatePreferences() should show an error notification with a settings button when a ResponseError is caught and valid failure errors are returned", async function () {
    const errorResponse = new Response("Bad Request", { status: 400 });
    const fakeFailureError: updates.PreferencesFailureError = {
      code: "cert_not_found",
      title: "Cert file cannot be found",
      detail: "The cert file '/foo/bar/baz' cannot be found.",
      source: "/spec/tls_pem_paths",
    };
    sandbox.stub(errorResponse, "clone").returns(errorResponse);
    sandbox.stub(errorResponse, "json").resolves({ errors: [fakeFailureError] });
    const error = new ResponseError(errorResponse);

    mockClient.gatewayV1PreferencesPut.rejects(error);

    await updates.updatePreferences();

    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWithExactly(
      logErrorStub,
      sinon.match.instanceOf(ResponseError).and(sinon.match.has("response", errorResponse)),
      "updating preferences",
      { extra: { functionName: "updatePreferences" } },
    );
    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    const callArgs = showErrorNotificationWithButtonsStub.getCall(0).args;
    assert.strictEqual(callArgs[0], `Failed to sync settings: ${fakeFailureError.detail}`);
    assert.ok(Object.keys(callArgs[1]).includes("Update Settings"));
    assert.ok(Object.keys(callArgs[1]).includes("Open Logs"));
    assert.ok(Object.keys(callArgs[1]).includes("File Issue"));
  });
});
