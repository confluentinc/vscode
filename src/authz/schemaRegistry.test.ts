import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import { TokenManager } from "../auth/oauth2/tokenManager";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { CCLOUD_BASE_PATH, UTM_SOURCE_VSCODE } from "../constants";
import { SCHEMA_RBAC_WARNINGS_ENABLED } from "../extensionSettings/constants";
import type { CCloudResourceLoader } from "../loaders";
import { HttpError } from "../proxy/httpClient";
import * as schemaRegistryProxyModule from "../proxy/schemaRegistryProxy";
import * as schemaRegistry from "./schemaRegistry";

describe("authz.schemaRegistry", function () {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;
  let ccloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let getDataPlaneTokenStub: sinon.SinonStub;
  let schemaRegistryProxyStub: sinon.SinonStubbedInstance<schemaRegistryProxyModule.SchemaRegistryProxy>;

  beforeEach(async function () {
    await getTestExtensionContext();

    sandbox = sinon.createSandbox();
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);

    ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
    ccloudLoader.getSchemaRegistryForEnvironmentId
      .withArgs(TEST_CCLOUD_SCHEMA_REGISTRY.environmentId)
      .resolves(TEST_CCLOUD_SCHEMA_REGISTRY);

    // Stub TokenManager.getInstance().getDataPlaneToken()
    getDataPlaneTokenStub = sandbox.stub(TokenManager.getInstance(), "getDataPlaneToken");

    // Create a stubbed SchemaRegistryProxy instance
    schemaRegistryProxyStub = sandbox.createStubInstance(
      schemaRegistryProxyModule.SchemaRegistryProxy,
    );

    // Stub the SchemaRegistryProxy constructor to return our stubbed instance
    sandbox
      .stub(schemaRegistryProxyModule, "SchemaRegistryProxy")
      .returns(schemaRegistryProxyStub as unknown as schemaRegistryProxyModule.SchemaRegistryProxy);
  });

  afterEach(async function () {
    sandbox.restore();
  });

  // canAccessSchemaTypeForTopic() tests
  it("canAccessSchemaTypeForTopic() should return true if asked about a local topic.", async function () {
    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_LOCAL_KAFKA_TOPIC, "key");
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaTypeForTopic() should return true if asked about a direct connection topic.", async function () {
    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_DIRECT_KAFKA_TOPIC, "key");
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaTypeForTopic() should return true if schemaRegistry is not found", async function () {
    ccloudLoader.getSchemaRegistryForEnvironmentId
      .withArgs(TEST_CCLOUD_SCHEMA_REGISTRY.environmentId)
      .resolves(undefined);

    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_CCLOUD_KAFKA_TOPIC, "key");
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaTypeForTopic() should return false if no data plane token available", async function () {
    getDataPlaneTokenStub.resolves(null);

    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_CCLOUD_KAFKA_TOPIC, "key");
    assert.strictEqual(result, false);
  });

  describe("CCloud schema access checks", function () {
    beforeEach(function () {
      // Default to having a valid data plane token
      getDataPlaneTokenStub.resolves("test-data-plane-token");
    });

    it("should return true when subject exists and user has access", async function () {
      schemaRegistryProxyStub.listVersions.resolves([1, 2, 3]);

      const result = await schemaRegistry.canAccessSchemaTypeForTopic(
        TEST_CCLOUD_KAFKA_TOPIC,
        "value",
      );
      assert.strictEqual(result, true);
    });

    it("should return true when subject does not exist (40401)", async function () {
      schemaRegistryProxyStub.listVersions.rejects(
        new HttpError("Subject not found", 404, "Not Found", { error_code: 40401 }),
      );

      const result = await schemaRegistry.canAccessSchemaTypeForTopic(
        TEST_CCLOUD_KAFKA_TOPIC,
        "key",
      );
      assert.strictEqual(result, true);
    });

    it("should return true when schema not found (40403)", async function () {
      schemaRegistryProxyStub.listVersions.rejects(
        new HttpError("Schema not found", 404, "Not Found", { error_code: 40403 }),
      );

      const result = await schemaRegistry.canAccessSchemaTypeForTopic(
        TEST_CCLOUD_KAFKA_TOPIC,
        "key",
      );
      assert.strictEqual(result, true);
    });

    it("should return true on generic 404 without error code", async function () {
      schemaRegistryProxyStub.listVersions.rejects(new HttpError("Not Found", 404, "Not Found"));

      const result = await schemaRegistry.canAccessSchemaTypeForTopic(
        TEST_CCLOUD_KAFKA_TOPIC,
        "key",
      );
      assert.strictEqual(result, true);
    });

    it("should return false when user is denied access (40301)", async function () {
      schemaRegistryProxyStub.listVersions.rejects(
        new HttpError("User denied", 403, "Forbidden", { error_code: 40301 }),
      );

      const result = await schemaRegistry.canAccessSchemaTypeForTopic(
        TEST_CCLOUD_KAFKA_TOPIC,
        "key",
      );
      assert.strictEqual(result, false);
    });

    it("should return false on 401 Unauthorized", async function () {
      schemaRegistryProxyStub.listVersions.rejects(
        new HttpError("Unauthorized", 401, "Unauthorized"),
      );

      const result = await schemaRegistry.canAccessSchemaTypeForTopic(
        TEST_CCLOUD_KAFKA_TOPIC,
        "key",
      );
      assert.strictEqual(result, false);
    });

    it("should return false on 403 Forbidden", async function () {
      schemaRegistryProxyStub.listVersions.rejects(new HttpError("Forbidden", 403, "Forbidden"));

      const result = await schemaRegistry.canAccessSchemaTypeForTopic(
        TEST_CCLOUD_KAFKA_TOPIC,
        "key",
      );
      assert.strictEqual(result, false);
    });
  });

  // determineAccessFromResponseError() tests
  it("determineAccessFromResponseError() should return true for error code 40403 'Schema not found'", async function () {
    const response = new Response(JSON.stringify({ error_code: 40403 }));
    const result = await schemaRegistry.determineAccessFromResponseError(response);
    assert.strictEqual(result, true);
  });

  it("determineAccessFromResponseError() should return true for error code 40401 'Subject ... not found'", async function () {
    const response = new Response(JSON.stringify({ error_code: 40401 }));
    const result = await schemaRegistry.determineAccessFromResponseError(response);
    assert.strictEqual(result, true);
  });

  it("determineAccessFromResponseError() should return false for other errors (e.g. 'User is denied operation Read ...'", async function () {
    const response = new Response(JSON.stringify({ error_code: 40301 }));
    const result = await schemaRegistry.determineAccessFromResponseError(response);
    assert.strictEqual(result, false);
  });

  // showNoSchemaAccessWarningNotification() tests
  it("showNoSchemaAccessWarningNotification() should show warning if warnings are enabled", function () {
    stubbedConfigs.stubGet(SCHEMA_RBAC_WARNINGS_ENABLED, true);

    const showWarningMessageStub = sandbox.stub(window, "showWarningMessage").resolves(undefined);
    schemaRegistry.showNoSchemaAccessWarningNotification();
    sinon.assert.calledOnce(showWarningMessageStub);
  });

  it("showNoSchemaAccessWarningNotification() should not show warning if warnings are disabled", function () {
    stubbedConfigs.stubGet(SCHEMA_RBAC_WARNINGS_ENABLED, false);

    const showWarningMessageStub = sandbox.stub(window, "showWarningMessage").resolves(undefined);
    schemaRegistry.showNoSchemaAccessWarningNotification();
    sinon.assert.notCalled(showWarningMessageStub);
  });
});

describe("Test CCloudSchemaRegistry properties", () => {
  it("ccloudUrl should return the correct URL for ccloud schema registry cluster", () => {
    assert.strictEqual(
      `https://${CCLOUD_BASE_PATH}/environments/${TEST_CCLOUD_SCHEMA_REGISTRY.environmentId}/stream-governance/schema-registry/data-contracts?utm_source=${UTM_SOURCE_VSCODE}`,
      TEST_CCLOUD_SCHEMA_REGISTRY.ccloudUrl,
    );
  });

  it("ccloudApiKeysUrl should return the correct URL for ccloud schema registry cluster", () => {
    assert.strictEqual(
      `https://${CCLOUD_BASE_PATH}/settings/api-keys?resourceIds=${TEST_CCLOUD_SCHEMA_REGISTRY.id}&resourceScope=SchemaRegistry&utm_source=${UTM_SOURCE_VSCODE}`,
      TEST_CCLOUD_SCHEMA_REGISTRY.ccloudApiKeysUrl,
    );
  });
});
