import * as assert from "assert";
import * as sinon from "sinon";
import { workspace } from "vscode";
import {
  JsonNode,
  Preferences,
  PreferencesResourceApi,
  PreferencesSpec,
  ResponseError,
  SidecarError,
} from "../clients/sidecar";
import * as errors from "../errors";
import * as notifications from "../notifications";
import * as sidecar from "../sidecar";
import {
  DEFAULT_KRB5_CONFIG_PATH,
  DEFAULT_SSL_PEM_PATHS,
  DEFAULT_TRUST_ALL_CERTIFICATES,
  KRB5_CONFIG_PATH,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import * as updates from "./sidecarSync";
import { loadPreferencesFromWorkspaceConfig } from "./sidecarSync";

describe("extensionSettings/sidecarSync.ts", function () {
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
    showErrorNotificationWithButtonsStub = sandbox.stub(
      notifications,
      "showErrorNotificationWithButtons",
    );
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("loadDefaultPreferences() should load default preferences from the workspace configuration", async function () {
    // default values, no user changes
    const tlsPemPaths: string[] = DEFAULT_SSL_PEM_PATHS;
    const trustAllCerts = DEFAULT_TRUST_ALL_CERTIFICATES;
    const krb5Config = DEFAULT_KRB5_CONFIG_PATH;

    getConfigurationStub.withArgs(SSL_PEM_PATHS, DEFAULT_SSL_PEM_PATHS).returns(tlsPemPaths);
    getConfigurationStub
      .withArgs(SSL_VERIFY_SERVER_CERT_DISABLED, DEFAULT_TRUST_ALL_CERTIFICATES)
      .returns(trustAllCerts);
    getConfigurationStub.withArgs(KRB5_CONFIG_PATH, DEFAULT_KRB5_CONFIG_PATH).returns(krb5Config);

    const result: PreferencesSpec = loadPreferencesFromWorkspaceConfig();

    assert.deepStrictEqual(result, {
      kerberos_config_file_path: krb5Config,
      tls_pem_paths: DEFAULT_SSL_PEM_PATHS,
      trust_all_certificates: DEFAULT_TRUST_ALL_CERTIFICATES,
    });
  });

  it("loadDefaultPreferences() should load preferences with custom values", async function () {
    // simulate user changing from the default values
    const tlsPemPaths: string[] = ["path/to/custom.pem"];
    const trustAllCerts = true;
    const krb5Config = "path/to/custom/krb5.conf";

    getConfigurationStub.withArgs(SSL_PEM_PATHS, DEFAULT_SSL_PEM_PATHS).returns(tlsPemPaths);
    getConfigurationStub
      .withArgs(SSL_VERIFY_SERVER_CERT_DISABLED, DEFAULT_TRUST_ALL_CERTIFICATES)
      .returns(trustAllCerts);
    getConfigurationStub.withArgs(KRB5_CONFIG_PATH, DEFAULT_KRB5_CONFIG_PATH).returns(krb5Config);

    const result: PreferencesSpec = loadPreferencesFromWorkspaceConfig();

    assert.deepStrictEqual(result, {
      kerberos_config_file_path: krb5Config,
      tls_pem_paths: tlsPemPaths,
      trust_all_certificates: trustAllCerts,
    });
  });

  it("updatePreferences() should update preferences successfully based on workspace configs", async function () {
    // simulate user changing from the default values
    const tlsPemPaths: string[] = ["path/to/custom.pem"];
    const trustAllCerts = true;
    const krb5Config = "path/to/custom/krb5.conf";

    getConfigurationStub.withArgs(SSL_PEM_PATHS, DEFAULT_SSL_PEM_PATHS).returns(tlsPemPaths);
    getConfigurationStub
      .withArgs(SSL_VERIFY_SERVER_CERT_DISABLED, DEFAULT_TRUST_ALL_CERTIFICATES)
      .returns(trustAllCerts);
    getConfigurationStub.withArgs(KRB5_CONFIG_PATH, DEFAULT_KRB5_CONFIG_PATH).returns(krb5Config);

    const fakePreferences: Preferences = {
      api_version: "gateway/v1",
      kind: "Preferences",
      spec: {
        kerberos_config_file_path: krb5Config,
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

  it("updatePreferences() should log and not re-throw errors when syncing settings to the sidecar preferences API", async function () {
    const errorMessage = "Failed to update preferences";
    const error = new Error(errorMessage);
    mockClient.gatewayV1PreferencesPut.rejects(error);

    await updates.updatePreferences();

    sinon.assert.calledOnce(mockClient.gatewayV1PreferencesPut);
    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    const callArgs = showErrorNotificationWithButtonsStub.getCall(0).args;
    assert.strictEqual(callArgs[0], `Failed to sync settings: ${errorMessage}`);
    // non-ResponseError should go to Sentry
    sinon.assert.calledWithExactly(
      logErrorStub,
      sinon.match.instanceOf(Error).and(sinon.match.has("message", errorMessage)),
      "syncing settings to sidecar preferences API",
      { extra: { functionName: "updatePreferences" } },
    );
  });

  it("updatePreferences() should show an error notification when an Error is caught", async function () {
    const error = new Error("uh oh");
    mockClient.gatewayV1PreferencesPut.rejects(error);

    await updates.updatePreferences();

    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWithExactly(
      logErrorStub,
      sinon.match.instanceOf(Error).and(sinon.match.has("message", error.message)),
      "syncing settings to sidecar preferences API",
      { extra: { functionName: "updatePreferences" } },
    );

    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    const callArgs = showErrorNotificationWithButtonsStub.getCall(0).args;
    assert.strictEqual(callArgs[0], `Failed to sync settings: ${error.message}`);
  });

  it("updatePreferences() should show an error notification with a settings button when a ResponseError (status 400) is caught and valid failure errors are returned", async function () {
    const errorResponse = new Response("Bad Request", { status: 400 });
    const fakeFailureError = {
      code: "cert_not_found",
      title: "Cert file cannot be found",
      detail: "The cert file '/foo/bar/baz' cannot be found.",
      source: "/spec/tls_pem_paths" as JsonNode, // pointer to the specific field, not actual object
    } satisfies SidecarError;
    sandbox.stub(errorResponse, "clone").returns(errorResponse);
    sandbox.stub(errorResponse, "json").resolves({ errors: [fakeFailureError] });
    const error = new ResponseError(errorResponse);

    mockClient.gatewayV1PreferencesPut.rejects(error);

    await updates.updatePreferences();

    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    const callArgs = showErrorNotificationWithButtonsStub.getCall(0).args;
    assert.strictEqual(callArgs[0], `Failed to sync settings: ${fakeFailureError.detail}`);
    assert.ok(Object.keys(callArgs[1]).includes("Update Settings"));
    assert.ok(Object.keys(callArgs[1]).includes("Open Logs"));
    assert.ok(Object.keys(callArgs[1]).includes("File Issue"));
    // not sending error 400s to Sentry
    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWithExactly(
      logErrorStub,
      error,
      "syncing settings to sidecar preferences API",
      {},
    );
  });

  it("updatePreferences() should show an error notification with a settings button when a ResponseError (non-400 status) is caught and valid failure errors are returned", async function () {
    const errorResponse = new Response("Internal server error", { status: 500 });
    const fakeFailureError = {
      code: "cert_not_found",
      title: "Cert file cannot be found",
      detail: "The cert file '/foo/bar/baz' cannot be found.",
      source: "/spec/tls_pem_paths" as JsonNode, // pointer to the specific field, not actual object
    } satisfies SidecarError;
    sandbox.stub(errorResponse, "clone").returns(errorResponse);
    sandbox.stub(errorResponse, "json").resolves({ errors: [fakeFailureError] });
    const error = new ResponseError(errorResponse);

    mockClient.gatewayV1PreferencesPut.rejects(error);

    await updates.updatePreferences();

    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    const callArgs = showErrorNotificationWithButtonsStub.getCall(0).args;
    assert.strictEqual(callArgs[0], `Failed to sync settings: ${fakeFailureError.detail}`);
    assert.ok(Object.keys(callArgs[1]).includes("Update Settings"));
    assert.ok(Object.keys(callArgs[1]).includes("Open Logs"));
    assert.ok(Object.keys(callArgs[1]).includes("File Issue"));
    // not an expected 400 error, so send to Sentry and let the team triage
    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWithExactly(
      logErrorStub,
      error,
      "syncing settings to sidecar preferences API",
      {
        extra: { functionName: "updatePreferences" },
      },
    );
  });
});
