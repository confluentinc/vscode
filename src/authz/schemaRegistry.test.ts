import * as assert from "assert";
import sinon from "sinon";
import { window, workspace } from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ResponseError, SubjectsV1Api } from "../clients/schemaRegistryRest";
import { SCHEMA_RBAC_WARNINGS_ENABLED } from "../preferences/constants";
import * as sidecar from "../sidecar";
import { getResourceManager, ResourceManager } from "../storage/resourceManager";
import * as schemaRegistry from "./schemaRegistry";

describe("authz.schemaRegistry", function () {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<SubjectsV1Api>;
  let getConfigurationStub: sinon.SinonStub;
  let resourceManager: ResourceManager;

  beforeEach(async function () {
    // preload the schema registry in extension state
    await getTestExtensionContext();
    resourceManager = getResourceManager();
    await resourceManager.setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);

    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    mockClient = sandbox.createStubInstance(SubjectsV1Api);
    mockSidecarHandle.getSubjectsV1Api.returns(mockClient);
    // stub the getSidecar function to return the mock sidecar handle
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
    // mock the workspace configuration until we can solve this in the test runner:
    // "Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again.: CodeExpectedError: Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again."
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
  });

  afterEach(async function () {
    sandbox.restore();
    // clear out the existing Schema Registry after each test
    await resourceManager.deleteCCloudSchemaRegistries(TEST_CCLOUD_SCHEMA_REGISTRY.environmentId);
  });

  // FIXME: canAccessSchemaForTopic() tests
  // it("canAccessSchemaForTopic() should return true if both key and value access are true", async function () {
  //   const stub = sandbox.stub(schemaRegistry, "canAccessSchemaTypeForTopic").resolves(true);
  //   const result = await schemaRegistry.canAccessSchemaForTopic(TEST_CCLOUD_KAFKA_TOPIC);
  //   assert.ok(stub.calledTwice);
  //   assert.strictEqual(result, true);
  // });

  // it("canAccessSchemaForTopic() should return true if either key or value access is true", async function () {
  //   // stub the canAccessSchemaTypeForTopic "key" request to return true, "value" to return false
  //   const topic = TEST_CCLOUD_KAFKA_TOPIC;
  //   const stub = sandbox
  //     .stub(schemaRegistry, "canAccessSchemaTypeForTopic")
  //     .withArgs(topic, "key")
  //     .resolves(true)
  //     .withArgs(topic, "value")
  //     .resolves(false);
  //   const result = await schemaRegistry.canAccessSchemaForTopic(topic);
  //   assert.ok(stub.calledTwice);
  //   assert.strictEqual(result, true);
  // });

  // it("canAccessSchemaForTopic() should return false if both key and value access are false", async function () {
  //   const stub = sandbox.stub(schemaRegistry, "canAccessSchemaTypeForTopic").resolves(false);
  //   const result = await schemaRegistry.canAccessSchemaForTopic(TEST_CCLOUD_KAFKA_TOPIC);
  //   assert.ok(stub.calledTwice);
  //   assert.strictEqual(result, false);
  // });

  // canAccessSchemaTypeForTopic() tests
  it("canAccessSchemaTypeForTopic() should return true if environmentId is not present", async function () {
    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_LOCAL_KAFKA_TOPIC, "key");
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaTypeForTopic() should return true if schemaRegistry is not found", async function () {
    // clear out the existing Schema Registry before checking schema access
    await resourceManager.deleteCCloudSchemaRegistries(TEST_CCLOUD_SCHEMA_REGISTRY.environmentId);

    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_CCLOUD_KAFKA_TOPIC, "key");
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaTypeForTopic() should return true on successful response to the 'lookUpSchemaUnderSubject' endpoint", async function () {
    mockClient.lookUpSchemaUnderSubject.resolves({});
    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_CCLOUD_KAFKA_TOPIC, "key");
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaTypeForTopic() should return false on a 403 ResponseError", async function () {
    const error = new ResponseError(new Response(null, { status: 403 }));
    mockClient.lookUpSchemaUnderSubject.rejects(error);
    sandbox.stub(schemaRegistry, "determineAccessFromResponseError").resolves(false);
    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_CCLOUD_KAFKA_TOPIC, "key");
    assert.strictEqual(result, false);
  });

  it("canAccessSchemaTypeForTopic() should return false on other response errors", async function () {
    mockClient.lookUpSchemaUnderSubject.rejects(new Error("test error"));
    const result = await schemaRegistry.canAccessSchemaTypeForTopic(TEST_CCLOUD_KAFKA_TOPIC, "key");
    assert.strictEqual(result, false);
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
    const mockConfig = {
      get: sandbox.stub().withArgs(SCHEMA_RBAC_WARNINGS_ENABLED).returns(true),
    };
    getConfigurationStub.returns(mockConfig);

    const showWarningMessageStub = sandbox.stub(window, "showWarningMessage").resolves(undefined);
    schemaRegistry.showNoSchemaAccessWarningNotification();
    assert.ok(showWarningMessageStub.calledOnce);
  });

  it("showNoSchemaAccessWarningNotification() should not show warning if warnings are disabled", function () {
    const mockConfig = {
      get: sandbox.stub().withArgs(SCHEMA_RBAC_WARNINGS_ENABLED).returns(false),
    };
    getConfigurationStub.returns(mockConfig);

    const showWarningMessageStub = sandbox.stub(window, "showWarningMessage").resolves(undefined);
    schemaRegistry.showNoSchemaAccessWarningNotification();
    assert.ok(showWarningMessageStub.notCalled);
  });
});

describe("Test CCloudSchemaRegistry properties", () => {
  it("ccloudUrl should return the correct URL for ccloud kafka cluster", () => {
    assert.strictEqual(
      `https://confluent.cloud/environments/${TEST_CCLOUD_SCHEMA_REGISTRY.environmentId}/stream-governance/schema-registry/data-contracts`,
      TEST_CCLOUD_SCHEMA_REGISTRY.ccloudUrl,
    );
  });

  it("ccloudApiKeysUrl should return the correct URL for ccloud kafka cluster", () => {
    assert.strictEqual(
      `https://confluent.cloud/environments/${TEST_CCLOUD_SCHEMA_REGISTRY.environmentId}/schema-registry/api-keys`,
      TEST_CCLOUD_SCHEMA_REGISTRY.ccloudApiKeysUrl,
    );
  });
});
