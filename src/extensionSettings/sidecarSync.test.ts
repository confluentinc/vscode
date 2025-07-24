import * as assert from "assert";
import * as sinon from "sinon";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
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
  CCLOUD_PRIVATE_NETWORK_ENDPOINTS,
  KRB5_CONFIG_PATH,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import * as updates from "./sidecarSync";
import { loadPreferencesFromWorkspaceConfig } from "./sidecarSync";

describe("extensionSettings/sidecarSync.ts", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("loadDefaultPreferences()", function () {
    let stubbedConfigs: StubbedWorkspaceConfiguration;

    beforeEach(function () {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    });

    it("should load default preferences from the workspace configuration", async function () {
      // default values, no user changes
      stubbedConfigs
        .stubGet(SSL_PEM_PATHS, SSL_PEM_PATHS.defaultValue)
        .stubGet(SSL_VERIFY_SERVER_CERT_DISABLED, SSL_VERIFY_SERVER_CERT_DISABLED.defaultValue)
        .stubGet(KRB5_CONFIG_PATH, KRB5_CONFIG_PATH.defaultValue)
        .stubGet(CCLOUD_PRIVATE_NETWORK_ENDPOINTS, CCLOUD_PRIVATE_NETWORK_ENDPOINTS.defaultValue);

      const result: PreferencesSpec = loadPreferencesFromWorkspaceConfig();

      assert.deepStrictEqual(result, {
        tls_pem_paths: SSL_PEM_PATHS.defaultValue,
        trust_all_certificates: SSL_VERIFY_SERVER_CERT_DISABLED.defaultValue,
        kerberos_config_file_path: KRB5_CONFIG_PATH.defaultValue,
        flink_private_endpoints: CCLOUD_PRIVATE_NETWORK_ENDPOINTS.defaultValue,
      });
    });

    it("should load preferences with custom values", async function () {
      // simulate user changing from the default values
      const tlsPemPaths: string[] = ["path/to/custom.pem"];
      const trustAllCerts = true;
      const krb5Config = "path/to/custom/krb5.conf";
      const endpoints: string[] = ["endpoint1a,endpoint1b ", "endpoint2"];
      const privateNetworkEndpoints: Record<string, string> = {
        env1: endpoints[0],
        env2: endpoints[1],
      };
      stubbedConfigs
        .stubGet(SSL_PEM_PATHS, tlsPemPaths)
        .stubGet(SSL_VERIFY_SERVER_CERT_DISABLED, trustAllCerts)
        .stubGet(KRB5_CONFIG_PATH, krb5Config)
        .stubGet(CCLOUD_PRIVATE_NETWORK_ENDPOINTS, privateNetworkEndpoints);

      const result: PreferencesSpec = loadPreferencesFromWorkspaceConfig();

      assert.deepStrictEqual(result, {
        kerberos_config_file_path: krb5Config,
        tls_pem_paths: tlsPemPaths,
        trust_all_certificates: trustAllCerts,
        flink_private_endpoints: {
          env1: ["endpoint1a", "endpoint1b"], // comma-split and whitespace-trimmed
          env2: ["endpoint2"],
        },
      });
    });
  });

  describe("splitPrivateNetworkEndpoints()", function () {
    it("should split private network endpoints into a Record of string arrays", function () {
      const rawEndpoints: Record<string, string> = {
        env1: "endpoint1a, endpoint1b",
        env2: "endpoint2",
      };
      const result = updates.splitPrivateNetworkEndpoints(rawEndpoints);

      assert.deepStrictEqual(result, {
        env1: ["endpoint1a", "endpoint1b"],
        env2: ["endpoint2"],
      });
    });

    it("should handle empty values and whitespace", function () {
      const rawEndpoints: Record<string, string> = {
        env1: "  , endpoint1b,  ",
        env2: "endpoint2,  ",
      };
      const result = updates.splitPrivateNetworkEndpoints(rawEndpoints);

      assert.deepStrictEqual(result, {
        env1: ["endpoint1b"],
        env2: ["endpoint2"],
      });
    });
  });

  describe("updatePreferences()", function () {
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let logErrorStub: sinon.SinonStub;
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;
    let stubbedSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;
    let stubbedPreferencesResourceApi: sinon.SinonStubbedInstance<PreferencesResourceApi>;

    beforeEach(function () {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);

      logErrorStub = sandbox.stub(errors, "logError");

      showErrorNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showErrorNotificationWithButtons",
      );

      stubbedPreferencesResourceApi = sandbox.createStubInstance(PreferencesResourceApi);
      stubbedSidecarHandle = getSidecarStub(sandbox);
      stubbedSidecarHandle.getPreferencesApi.returns(stubbedPreferencesResourceApi);
    });

    it("should update preferences successfully based on workspace configs", async function () {
      // simulate user changing from the default values
      const tlsPemPaths: string[] = ["path/to/custom.pem"];
      const trustAllCerts = true;
      const krb5Config = "path/to/custom/krb5.conf";
      const privateNetworkEndpoints: Record<string, string> = {
        env1: "endpoint1",
        env2: "endpoint2",
      };
      stubbedConfigs
        .stubGet(SSL_PEM_PATHS, tlsPemPaths)
        .stubGet(SSL_VERIFY_SERVER_CERT_DISABLED, trustAllCerts)
        .stubGet(KRB5_CONFIG_PATH, krb5Config)
        .stubGet(CCLOUD_PRIVATE_NETWORK_ENDPOINTS, privateNetworkEndpoints);

      const fakePreferences: Preferences = {
        api_version: "gateway/v1",
        kind: "Preferences",
        spec: {
          kerberos_config_file_path: krb5Config,
          tls_pem_paths: tlsPemPaths,
          trust_all_certificates: trustAllCerts,
          flink_private_endpoints: updates.splitPrivateNetworkEndpoints(privateNetworkEndpoints),
        },
      };
      stubbedPreferencesResourceApi.gatewayV1PreferencesPut.resolves(fakePreferences);

      await updates.updatePreferences();

      sinon.assert.calledWithExactly(stubbedPreferencesResourceApi.gatewayV1PreferencesPut, {
        Preferences: fakePreferences,
      });
      sinon.assert.notCalled(logErrorStub);
      sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
    });

    it("should log and not re-throw errors when syncing settings to the sidecar preferences API", async function () {
      const errorMessage = "Failed to update preferences";
      const error = new Error(errorMessage);
      stubbedPreferencesResourceApi.gatewayV1PreferencesPut.rejects(error);

      await updates.updatePreferences();

      sinon.assert.calledOnce(stubbedPreferencesResourceApi.gatewayV1PreferencesPut);
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

    it("should show an error notification when an Error is caught", async function () {
      const error = new Error("uh oh");
      stubbedPreferencesResourceApi.gatewayV1PreferencesPut.rejects(error);

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

    it("should show an error notification with a settings button when a ResponseError (status 400) is caught and valid failure errors are returned", async function () {
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

      stubbedPreferencesResourceApi.gatewayV1PreferencesPut.rejects(error);

      await updates.updatePreferences();

      sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
      sinon.assert.calledOnceWithExactly(
        showErrorNotificationWithButtonsStub,
        `Failed to sync settings: ${fakeFailureError.detail}`,
        {
          "Update Settings": sinon.match.func,
          "Open Logs": sinon.match.func,
          "File Issue": sinon.match.func,
        },
      );
      // not sending error 400s to Sentry
      sinon.assert.calledOnce(logErrorStub);
      sinon.assert.calledWithExactly(
        logErrorStub,
        error,
        "syncing settings to sidecar preferences API",
        {},
      );
    });

    it("should show an error notification with a settings button when a ResponseError (non-400 status) is caught and valid failure errors are returned", async function () {
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

      stubbedPreferencesResourceApi.gatewayV1PreferencesPut.rejects(error);

      await updates.updatePreferences();

      sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
      sinon.assert.calledOnceWithExactly(
        showErrorNotificationWithButtonsStub,
        `Failed to sync settings: ${fakeFailureError.detail}`,
        {
          "Update Settings": sinon.match.func,
          "Open Logs": sinon.match.func,
          "File Issue": sinon.match.func,
        },
      );
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
});
