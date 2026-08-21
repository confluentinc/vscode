import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { ResponseError, SubjectsV1Api } from "../clients/schemaRegistryRest";
import { CCLOUD_BASE_PATH, UTM_SOURCE_VSCODE } from "../constants";
import { SCHEMA_RBAC_WARNINGS_ENABLED } from "../extensionSettings/constants";
import type { CCloudResourceLoader } from "../loaders";
import type { KafkaTopic } from "../models/topic";
import type { SidecarHandle } from "../sidecar";
import * as schemaRegistry from "./schemaRegistry";

describe("authz.schemaRegistry", function () {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<SubjectsV1Api>;
  let stubbedConfigs: StubbedWorkspaceConfiguration;
  let ccloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

  beforeEach(async function () {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    const stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle> = getSidecarStub(sandbox);
    mockClient = sandbox.createStubInstance(SubjectsV1Api);
    stubbedSidecar.getSubjectsV1Api.returns(mockClient);

    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);

    ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
    // By default, set the ccloudLoader to return the TEST_CCLOUD_SCHEMA_REGISTRY for its environmentId
    ccloudLoader.getSchemaRegistryForEnvironmentId
      .withArgs(TEST_CCLOUD_SCHEMA_REGISTRY.environmentId)
      .resolves(TEST_CCLOUD_SCHEMA_REGISTRY);
  });

  afterEach(async function () {
    sandbox.restore();
  });

  // canAccessSchemaForTopic() tests. These go through the stubbed SubjectsV1Api client because
  // canAccessSchemaTypeForTopic() is an in-module call Sinon can't stub.

  // a denial-shaped ResponseError (403 with a non-access error_code) so the real
  // determineAccessFromResponseError() path runs; fresh instance per call since the body reads once.
  function schemaAccessDeniedError(): ResponseError {
    return new ResponseError(new Response(JSON.stringify({ error_code: 40301 }), { status: 403 }));
  }

  // assert both the key and value subjects were looked up exactly once, not just that two lookups
  // happened (a regression querying the key subject twice would satisfy a bare count check).
  function assertKeyAndValueSubjectsLookedUp(topic: KafkaTopic): void {
    sinon.assert.calledTwice(mockClient.lookUpSchemaUnderSubject);
    sinon.assert.calledWith(
      mockClient.lookUpSchemaUnderSubject,
      sinon.match({ subject: `${topic.name}-key` }),
    );
    sinon.assert.calledWith(
      mockClient.lookUpSchemaUnderSubject,
      sinon.match({ subject: `${topic.name}-value` }),
    );
  }

  it("canAccessSchemaForTopic() should return true if both key and value access are true", async function () {
    mockClient.lookUpSchemaUnderSubject.resolves({});

    const result = await schemaRegistry.canAccessSchemaForTopic(TEST_CCLOUD_KAFKA_TOPIC);

    assertKeyAndValueSubjectsLookedUp(TEST_CCLOUD_KAFKA_TOPIC);
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaForTopic() should return true if either key or value access is true", async function () {
    const topic = TEST_CCLOUD_KAFKA_TOPIC;
    // "key" subject lookup succeeds (access), "value" is denied
    mockClient.lookUpSchemaUnderSubject
      .withArgs(sinon.match({ subject: `${topic.name}-key` }))
      .resolves({});
    mockClient.lookUpSchemaUnderSubject
      .withArgs(sinon.match({ subject: `${topic.name}-value` }))
      .rejects(schemaAccessDeniedError());

    const result = await schemaRegistry.canAccessSchemaForTopic(topic);

    assertKeyAndValueSubjectsLookedUp(topic);
    assert.strictEqual(result, true);
  });

  it("canAccessSchemaForTopic() should return false if both key and value access are false", async function () {
    mockClient.lookUpSchemaUnderSubject.callsFake(() => Promise.reject(schemaAccessDeniedError()));

    const result = await schemaRegistry.canAccessSchemaForTopic(TEST_CCLOUD_KAFKA_TOPIC);

    assertKeyAndValueSubjectsLookedUp(TEST_CCLOUD_KAFKA_TOPIC);
    assert.strictEqual(result, false);
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
    // clear out the existing Schema Registry before checking schema access.
    ccloudLoader.getSchemaRegistryForEnvironmentId
      .withArgs(TEST_CCLOUD_SCHEMA_REGISTRY.environmentId)
      .resolves(undefined);

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
