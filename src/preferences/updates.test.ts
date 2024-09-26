import * as assert from "assert";
import sinon from "sinon";
import {
  Preferences,
  PreferencesResourceApi,
  PreferencesSpec,
  ResponseError,
} from "../clients/sidecar";
import * as sidecar from "../sidecar";
import * as updates from "./updates";

describe("preferences/updates", function () {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<PreferencesResourceApi>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    mockClient = sandbox.createStubInstance(PreferencesResourceApi);
    mockSidecarHandle.getPreferencesApi.returns(mockClient);
    // stub the getSidecar function to return the mock sidecar handle
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should fetch preferences successfully", async function () {
    const mockPreferences: Preferences = { spec: {} } as Preferences;
    mockClient.gatewayV1PreferencesGet.resolves(mockPreferences);

    const result = await updates.fetchPreferences();

    assert.strictEqual(result, mockPreferences);
  });

  it("should rethrow if fetchPreferences fails with ResponseError", async function () {
    const mockError = new ResponseError(
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );
    mockClient.gatewayV1PreferencesGet.rejects(mockError);

    await assert.rejects(updates.fetchPreferences(), mockError);
  });

  it("should rethrow if fetchPreferences fails with non-ResponseError", async function () {
    const mockError = new Error("Some error");
    mockClient.gatewayV1PreferencesGet.rejects(mockError);

    await assert.rejects(updates.fetchPreferences(), mockError);
  });

  it("should update preferences successfully", async function () {
    const mockPreferences: Preferences = { spec: {} } as Preferences;
    mockClient.gatewayV1PreferencesGet.resolves(mockPreferences);
    const mockUpdatedSpec: PreferencesSpec = { tls_pem_paths: ["path/to/pem"] };
    const mockUpdatedPreferences: Preferences = {
      ...mockPreferences,
      spec: mockUpdatedSpec,
    };
    mockClient.gatewayV1PreferencesPut.resolves(mockUpdatedPreferences);

    await updates.updatePreferences(mockUpdatedSpec);

    assert.ok(mockClient.gatewayV1PreferencesPut.calledOnce);
  });
});
