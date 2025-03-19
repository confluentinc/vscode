import * as assert from "assert";
import * as sinon from "sinon";
import { workspace } from "vscode";
import { Preferences, PreferencesResourceApi, PreferencesSpec } from "../clients/sidecar";
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

  it("should update preferences successfully", async function () {
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
  });

  it("updatePreferences() should log and not re-throw errors when updating preferences", async function () {
    const errorMessage = "Failed to update preferences";
    mockClient.gatewayV1PreferencesPut.rejects(new Error(errorMessage));

    await updates.updatePreferences();

    sinon.assert.calledOnce(mockClient.gatewayV1PreferencesPut);
    sinon.assert.calledWithExactly(
      logErrorStub,
      sinon.match.instanceOf(Error),
      "updating preferences",
      {},
      true,
    );
  });
});
