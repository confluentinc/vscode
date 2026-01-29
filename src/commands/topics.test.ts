import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
// TODO(sidecar-removal): Many imports were removed during sidecar migration.
// The affected tests have been skipped until direct API clients are available.
import { JSON_DIAGNOSTIC_COLLECTION } from "../diagnostics/constants";
import { PRODUCE_MESSAGE_SCHEMA, SubjectNameStrategy } from "../diagnostics/produceMessage";
import * as jsonParsing from "../documentParsing/json";
import { FLINK_SQL_LANGUAGE_ID } from "../flinkSql/constants";
import type { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { KafkaTopic } from "../models/topic";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import type { ExecutionResult } from "../utils/workerPool";
import type { ProduceResult } from "./topics";
import {
  handleSchemaValidationErrors,
  ProduceMessageBadRequestError,
  queryTopicWithFlink,
  summarizeErrors,
} from "./topics";

// TODO(sidecar-removal): These tests require getSidecarHandle which was removed during
// sidecar migration. Re-implement once direct API client is available.
describe.skip("commands/topics.ts produceMessageFromDocument() without schemas", function () {
  it("should show an error notification if no topic is provided", async function () {});
  it("should exit early if no file/editor is selected from the URI quickpick", async function () {});
  it("should show an error notification for an invalid JSON message", async function () {});
  it("should show a success (info) notification after valid produce response", async function () {});
  it("should show an error notification for any ResponseErrors", async function () {});
  it("should pass `partition_id` and `timestamp` in the produce request if provided", async function () {});
  it("should handle optional fields independently", async function () {});
  it("should open message viewer without a 'textFilter' if the produce-message 'key' is not a primitive type or is null", async function () {});
  it("should open message viewer with a 'textFilter' if the produce-message 'key' is a primitive type", async function () {});
});

// TODO(sidecar-removal): These tests require getSidecarHandle which was removed during
// sidecar migration. Re-implement once direct API client is available.
describe.skip("commands/topics.ts produceMessageFromDocument() with schema(s)", function () {
  it("should exit early if schema kind selection is cancelled", async function () {});
  it("should handle key schema only selection", async function () {});
  it("should handle value schema only selection", async function () {});
  it("should handle both key and value schema selection", async function () {});
  it("should handle the deferToDocument option", async function () {});
  it("should handle errors in promptForSchema", async function () {});
});

describe("commands/topics.ts summarizeErrors()", function () {
  it("should return empty string when no errors are provided", function () {
    const result = summarizeErrors([]);

    assert.strictEqual(result, "");
  });

  it("should return a single error message when one error is provided", function () {
    const error = new Error("Test error message");

    const result = summarizeErrors([error]);

    assert.strictEqual(result, "Test error message");
  });

  it("should return empty string when a single error is provided but its type is in the ignored list", function () {
    const error = new Error("Test error message");
    error.name = "IgnoredErrorType";

    const result = summarizeErrors([error], ["IgnoredErrorType"]);

    assert.strictEqual(result, "");
  });

  it("should aggregate multiple errors with the same message", function () {
    const errors = [new Error("Error 1"), new Error("Error 1"), new Error("Error 2")];

    const result = summarizeErrors(errors);

    assert.strictEqual(result, "Error 1 (x2), Error 2 (x1)");
  });

  it("should limit the number of unique error messages in the summary", function () {
    const errors = [
      new Error("Error 1"),
      new Error("Error 1"),
      new Error("Error 2"),
      new Error("Error 3"),
      new Error("Error 4"),
    ];

    const result = summarizeErrors(errors, [], 2);

    // only show the top two errors
    assert.strictEqual(result, "Error 1 (x2), Error 2 (x1)");
  });

  it("should sort error messages in descending order by count", function () {
    const errors = [
      new Error("Error 1"),
      new Error("Error 2"),
      new Error("Error 2"),
      new Error("Error 3"),
      new Error("Error 3"),
      new Error("Error 3"),
    ];

    const result = summarizeErrors(errors);

    assert.strictEqual(result, "Error 3 (x3), Error 2 (x2), Error 1 (x1)");
  });

  it("should ignore errors of specified types", function () {
    const errors = [
      new Error("Regular error"),
      new Error("Schema error"),
      new Error("Schema error"),
    ];
    errors[1].name = "ProduceMessageBadRequestError";
    errors[2].name = "ProduceMessageBadRequestError";

    const result = summarizeErrors(errors, ["ProduceMessageBadRequestError"]);

    assert.strictEqual(result, "Regular error (x1)");
  });
});

describe("commands/topics.ts handleSchemaValidationErrors()", function () {
  let sandbox: sinon.SinonSandbox;
  let getRangeForDocumentStub: sinon.SinonStub;
  let diagnosticCollectionSetStub: sinon.SinonStub;

  const messageUri = vscode.Uri.file("test.json");

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // stub getRangeForDocument to return a predictable range
    getRangeForDocumentStub = sandbox
      .stub(jsonParsing, "getRangeForDocument")
      .resolves(new vscode.Range(0, 0, 1, 10));

    // stub the diagnostic collection's set method
    diagnosticCollectionSetStub = sandbox.stub();
    sandbox.stub(JSON_DIAGNOSTIC_COLLECTION, "set").value(diagnosticCollectionSetStub);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return empty array when no validation errors are found", async function () {
    const results: ExecutionResult<ProduceResult>[] = [
      { result: undefined, error: new Error("Regular error") },
    ];

    const diagnostics = await handleSchemaValidationErrors(results, messageUri);

    assert.strictEqual(diagnostics.length, 0);
    sinon.assert.notCalled(getRangeForDocumentStub);
    sinon.assert.notCalled(diagnosticCollectionSetStub);
  });

  it("should create diagnostics for ProduceMessageBadRequestError with key schema", async function () {
    // validation error for a key schema
    const badRequestError = new ProduceMessageBadRequestError(
      "Invalid key schema",
      {
        key: { subject_name_strategy: SubjectNameStrategy.TOPIC_NAME },
        value: {},
      } as any,
      new Response(),
    );
    const results: ExecutionResult<ProduceResult>[] = [
      { result: undefined, error: badRequestError },
    ];

    const diagnostics = await handleSchemaValidationErrors(results, messageUri);

    assert.strictEqual(diagnostics.length, 1);
    sinon.assert.calledOnce(getRangeForDocumentStub);
    sinon.assert.calledWith(getRangeForDocumentStub, messageUri, PRODUCE_MESSAGE_SCHEMA, 0, "key");
    sinon.assert.calledOnce(diagnosticCollectionSetStub);
  });

  it("should create diagnostics for ProduceMessageBadRequestError with value schema", async function () {
    // validation error for a value schema
    const badRequestError = new ProduceMessageBadRequestError(
      "Invalid value schema",
      {
        key: {},
        value: { subject_name_strategy: SubjectNameStrategy.TOPIC_NAME },
      } as any,
      new Response(),
    );
    const results: ExecutionResult<ProduceResult>[] = [
      { result: undefined, error: badRequestError },
    ];

    const diagnostics = await handleSchemaValidationErrors(results, messageUri);

    assert.strictEqual(diagnostics.length, 1);
    sinon.assert.calledOnce(getRangeForDocumentStub);
    sinon.assert.calledWith(
      getRangeForDocumentStub,
      messageUri,
      PRODUCE_MESSAGE_SCHEMA,
      0,
      "value",
    );
  });

  it("should create multiple diagnostics for errors with both key and value issues", async function () {
    // validation error for both key and value schemas
    const badRequestError = new ProduceMessageBadRequestError(
      "Invalid schemas",
      {
        key: { subject_name_strategy: SubjectNameStrategy.TOPIC_NAME },
        value: { subject_name_strategy: SubjectNameStrategy.TOPIC_NAME },
      } as any,
      new Response(),
    );
    const results: ExecutionResult<ProduceResult>[] = [
      { result: undefined, error: badRequestError },
    ];

    const diagnostics = await handleSchemaValidationErrors(results, messageUri);

    assert.strictEqual(diagnostics.length, 2);
    assert.strictEqual(getRangeForDocumentStub.callCount, 2);

    // first call for `key`, second for `value`
    sinon.assert.calledWith(
      getRangeForDocumentStub.firstCall,
      messageUri,
      PRODUCE_MESSAGE_SCHEMA,
      0,
      "key",
    );
    sinon.assert.calledWith(
      getRangeForDocumentStub.secondCall,
      messageUri,
      PRODUCE_MESSAGE_SCHEMA,
      0,
      "value",
    );
    // make sure the key and value ranges are different
    assert.notStrictEqual(
      getRangeForDocumentStub.firstCall.returnValue,
      getRangeForDocumentStub.secondCall.returnValue,
    );
  });

  it("should handle multiple errors across different indices", async function () {
    // simulate errors at different message indices
    const error1 = new ProduceMessageBadRequestError(
      "Invalid key schema at index 0",
      { key: { subject_name_strategy: SubjectNameStrategy.TOPIC_NAME } } as any,
      new Response(),
    );
    const error2 = new ProduceMessageBadRequestError(
      "Invalid value schema at index 1",
      { value: { subject_name_strategy: SubjectNameStrategy.TOPIC_NAME } } as any,
      new Response(),
    );
    const results: ExecutionResult<ProduceResult>[] = [
      { result: undefined, error: error1 },
      { result: undefined, error: error2 },
    ];

    const diagnostics = await handleSchemaValidationErrors(results, messageUri);

    assert.strictEqual(diagnostics.length, 2);
    assert.strictEqual(getRangeForDocumentStub.callCount, 2);

    // calls should be made with the correct message indices
    sinon.assert.calledWith(
      getRangeForDocumentStub.firstCall,
      messageUri,
      PRODUCE_MESSAGE_SCHEMA,
      0,
      "key",
    );
    sinon.assert.calledWith(
      getRangeForDocumentStub.secondCall,
      messageUri,
      PRODUCE_MESSAGE_SCHEMA,
      1,
      "value",
    );
  });
});

// TODO(sidecar-removal): These tests require getSidecarHandle which was removed during
// sidecar migration. Re-implement once direct API client is available.
describe.skip("commands/topics.ts produceMessage()", function () {
  it("should rethrow error 400 responses with JSON as ProduceMessageBadRequestErrors", async function () {});
  it("should rethrow error 400 responses with text as ProduceMessageBadRequestErrors", async function () {});
  it("should wrap 400 errors with invalid JSON as ProduceMessageBadRequestError", async function () {});
  it("should rethrow non-400 ResponseErrors and not wrap as ProduceMessageBadRequestErrors", async function () {});
  it("should re-throw non-ResponseError errors without wrapping", async function () {});
  it("should handle CCloud proxy response errors", async function () {});
  it("should include the original request when wrapping as ProduceMessageBadRequestErrors", async function () {});
  it("should handle empty responses in error handling", async function () {});
});

describe("commands/topics.ts queryTopicWithFlink()", function () {
  let sandbox: sinon.SinonSandbox;
  let openTextDocumentStub: sinon.SinonStub;
  let showTextDocumentStub: sinon.SinonStub;
  let ccloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let setUriMetadataStub: sinon.SinonStub;
  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

  const TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_FLINK = new CCloudEnvironment({
    ...TEST_CCLOUD_ENVIRONMENT,
    kafkaClusters: [TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER],
    flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
  });
  beforeEach(function () {
    sandbox = sinon.createSandbox();

    openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
    showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
    ccloudLoader = getStubbedCCloudResourceLoader(sandbox);

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);
    setUriMetadataStub = stubResourceManager.setUriMetadata;
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should create a new document with Flink SQL language and correct placeholder query for CCloud topic", async function () {
    ccloudLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_FLINK);
    ccloudLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

    const mockDocument = { uri: vscode.Uri.file("test.flink.sql") };
    openTextDocumentStub.resolves(mockDocument);
    showTextDocumentStub.resolves({ document: mockDocument });

    await queryTopicWithFlink(TEST_CCLOUD_KAFKA_TOPIC);

    sinon.assert.calledOnce(openTextDocumentStub);
    const expectedQuery = `-- Query topic "${TEST_CCLOUD_KAFKA_TOPIC.name}" with Flink SQL
-- Replace this with your actual Flink SQL query

SELECT *
FROM \`${TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_FLINK.name}\`.\`${TEST_CCLOUD_KAFKA_CLUSTER.name}\`.\`${TEST_CCLOUD_KAFKA_TOPIC.name}\`
LIMIT 10;`;
    sinon.assert.calledWithExactly(openTextDocumentStub, {
      language: FLINK_SQL_LANGUAGE_ID,
      content: expectedQuery,
    });

    sinon.assert.calledOnce(showTextDocumentStub);
    sinon.assert.calledWithExactly(showTextDocumentStub, mockDocument, { preview: false });
  });

  it("should set URI metadata correctly with compute pool ID and database ID", async function () {
    ccloudLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_FLINK);
    ccloudLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER]);

    const mockDocument = { uri: vscode.Uri.file("test.flink.sql") };
    openTextDocumentStub.resolves(mockDocument);
    showTextDocumentStub.resolves({ document: mockDocument });

    const flinkableTopic = new KafkaTopic({
      ...TEST_CCLOUD_KAFKA_TOPIC,
      clusterId: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
    });

    await queryTopicWithFlink(flinkableTopic);

    // verify document was opened
    sinon.assert.calledOnce(openTextDocumentStub);
    sinon.assert.calledOnce(showTextDocumentStub);

    // Verify that the URI metadata was set correctly
    sinon.assert.calledOnce(setUriMetadataStub);
    sinon.assert.calledWith(setUriMetadataStub, mockDocument.uri, {
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      [UriMetadataKeys.FLINK_CATALOG_ID]: TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_FLINK.id,
      [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_FLINK.name,
      [UriMetadataKeys.FLINK_DATABASE_ID]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
      [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name,
    });
  });

  it("should NOT set metadata if kafka cluster had no related Flink compute pools", async function () {
    ccloudLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_FLINK);
    ccloudLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

    const mockDocument = { uri: vscode.Uri.file("test.flink.sql") };
    openTextDocumentStub.resolves(mockDocument);
    showTextDocumentStub.resolves({ document: mockDocument });

    await queryTopicWithFlink(TEST_CCLOUD_KAFKA_TOPIC);

    // document was opened, but with defaults for codelensing since no compute pool was found
    sinon.assert.calledOnce(openTextDocumentStub);
    sinon.assert.calledOnce(showTextDocumentStub);

    sinon.assert.notCalled(setUriMetadataStub);
  });

  it("should return early if topic is null or not a KafkaTopic instance", async function () {
    await queryTopicWithFlink(null as any);

    sinon.assert.notCalled(openTextDocumentStub);
    sinon.assert.notCalled(showTextDocumentStub);
    sinon.assert.notCalled(ccloudLoader.getEnvironment);
    sinon.assert.notCalled(ccloudLoader.getKafkaClustersForEnvironmentId);
  });

  it("should return early if topic is not a KafkaTopic instance", async function () {
    const notATopic = { name: "fake-topic" };

    await queryTopicWithFlink(notATopic as any);

    sinon.assert.notCalled(openTextDocumentStub);
    sinon.assert.notCalled(showTextDocumentStub);
    sinon.assert.notCalled(ccloudLoader.getEnvironment);
    sinon.assert.notCalled(ccloudLoader.getKafkaClustersForEnvironmentId);
  });

  it("should return early if environment is missing", async function () {
    ccloudLoader.getEnvironment.resolves(undefined);
    ccloudLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

    await queryTopicWithFlink(TEST_CCLOUD_KAFKA_TOPIC);

    sinon.assert.calledOnce(ccloudLoader.getEnvironment);
    sinon.assert.notCalled(openTextDocumentStub);
    sinon.assert.notCalled(showTextDocumentStub);
  });

  it("should return early if cluster is missing", async function () {
    ccloudLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT);
    ccloudLoader.getKafkaClustersForEnvironmentId.resolves([]);

    await queryTopicWithFlink(TEST_CCLOUD_KAFKA_TOPIC);

    sinon.assert.calledOnce(ccloudLoader.getEnvironment);
    sinon.assert.calledOnce(ccloudLoader.getKafkaClustersForEnvironmentId);
    sinon.assert.notCalled(openTextDocumentStub);
    sinon.assert.notCalled(showTextDocumentStub);
  });

  it("should return early if topic is a local", async function () {
    await queryTopicWithFlink(TEST_LOCAL_KAFKA_TOPIC);

    sinon.assert.notCalled(openTextDocumentStub);
    sinon.assert.notCalled(showTextDocumentStub);
    sinon.assert.notCalled(ccloudLoader.getEnvironment);
    sinon.assert.notCalled(ccloudLoader.getKafkaClustersForEnvironmentId);
  });

  it("should return early if topic is a direct connection topic", async function () {
    await queryTopicWithFlink(TEST_DIRECT_KAFKA_TOPIC);

    sinon.assert.notCalled(openTextDocumentStub);
    sinon.assert.notCalled(showTextDocumentStub);
    sinon.assert.notCalled(ccloudLoader.getEnvironment);
    sinon.assert.notCalled(ccloudLoader.getKafkaClustersForEnvironmentId);
  });

  it("should not set metadata when no compute pool is available", async function () {
    ccloudLoader.getEnvironment.resolves(TEST_CCLOUD_ENVIRONMENT); // Using regular environment with no Flink compute pools
    ccloudLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

    const mockDocument = { uri: vscode.Uri.file("test.flink.sql") };
    openTextDocumentStub.resolves(mockDocument);
    showTextDocumentStub.resolves({ document: mockDocument });

    await queryTopicWithFlink(TEST_CCLOUD_KAFKA_TOPIC);

    // Should still create the document
    sinon.assert.calledOnce(openTextDocumentStub);
    // But should not set the metadata since there's no compute pool
    sinon.assert.notCalled(setUriMetadataStub);
  });
});
