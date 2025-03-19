import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_KEY_SCHEMA,
  TEST_LOCAL_SCHEMA,
} from "../../tests/unit/testResources";
import { ProduceRecordRequest, RecordsV3Api, ResponseError } from "../clients/kafkaRest";
import { ConfluentCloudProduceRecordsResourceApi } from "../clients/sidecar";
import { MessageViewerConfig } from "../consume";
import * as schemaQuickPicks from "../quickpicks/schemas";
import * as uriQuickpicks from "../quickpicks/uris";
import * as schemaSubjectUtils from "../quickpicks/utils/schemaSubjects";
import * as schemaUtils from "../quickpicks/utils/schemas";
import { JSON_DIAGNOSTIC_COLLECTION } from "../schemas/diagnosticCollection";
import * as parsing from "../schemas/parsing";
import {
  PRODUCE_MESSAGE_SCHEMA,
  ProduceMessage,
  SubjectNameStrategy,
} from "../schemas/produceMessageSchema";
import * as sidecar from "../sidecar";
import { ExecutionResult } from "../utils/workerPool";
import {
  handleSchemaValidationErrors,
  produceMessage,
  ProduceMessageBadRequestError,
  produceMessagesFromDocument,
  ProduceResult,
  summarizeErrors,
} from "./topics";
import { ProduceMessageSchemaOptions } from "./utils/types";

const fakeMessage = {
  key: "test-key",
  value: "test-value",
  headers: [{ key: "test-header", value: "test-header-value" }],
};

describe("commands/topics.ts produceMessageFromDocument() without schemas", function () {
  let sandbox: sinon.SinonSandbox;

  let showErrorMessageStub: sinon.SinonStub;
  let showInfoMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;

  let uriQuickpickStub: sinon.SinonStub;
  let loadDocumentContentStub: sinon.SinonStub;

  let clientStub: sinon.SinonStubbedInstance<RecordsV3Api>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
    showInfoMessageStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();
    executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

    // stub the quickpick for file/editor URI and the resulting content
    uriQuickpickStub = sandbox
      .stub(uriQuickpicks, "uriQuickpick")
      .resolves(vscode.Uri.file("test.json"));
    loadDocumentContentStub = sandbox
      .stub(uriQuickpicks, "loadDocumentContent")
      .resolves({ content: JSON.stringify(fakeMessage) });
    // assume schemaless produce for most tests
    const schemaLess: schemaQuickPicks.SchemaKindSelection = {
      keySchema: false,
      valueSchema: false,
      deferToDocument: false,
    };
    sandbox.stub(schemaQuickPicks, "schemaKindMultiSelect").resolves(schemaLess);

    // create the stubs for the sidecar + service client
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    clientStub = sandbox.createStubInstance(RecordsV3Api);
    mockSidecarHandle.getRecordsV3Api.returns(clientStub);
    // stub the getSidecar function to return the mock sidecar handle
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should show an error notification if no topic is provided", async function () {
    // shouldn't be possible based on the package.json configs, but just in case
    await produceMessagesFromDocument(null as any);

    assert.ok(showErrorMessageStub.calledOnceWith("No topic selected."));
  });

  it("should exit early if no file/editor is selected from the URI quickpick", async function () {
    uriQuickpickStub.resolves(undefined);

    // using local so we don't need to deal with the `type` lookups in `createProduceRequestData`;
    // see tests in suite below
    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(showErrorMessageStub.notCalled);
  });

  it("should show an error notification for an invalid JSON message", async function () {
    loadDocumentContentStub.resolves({ content: "{}" });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(showErrorMessageStub.calledOnce);
    const callArgs = showErrorMessageStub.getCall(0).args;
    assert.strictEqual(callArgs[0], "Unable to produce message(s): JSON schema validation failed.");
  });

  it("should show a success (info) notification after valid produce response", async function () {
    clientStub.produceRecord.resolves({
      error_code: 200,
      timestamp: new Date(),
      partition_id: 0,
    });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(clientStub.produceRecord.calledOnce);
    assert.ok(showInfoMessageStub.calledOnce);
    const successMsg = showInfoMessageStub.firstCall.args[0];
    assert.ok(successMsg.startsWith("Successfully produced 1 message to topic"), successMsg);
    assert.ok(showErrorMessageStub.notCalled);
  });

  it("should show an error notification for any ResponseErrors", async function () {
    clientStub.produceRecord.rejects(
      new ResponseError(
        new Response("", {
          status: 400,
          statusText: "Bad Request",
        }),
      ),
    );

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(showErrorMessageStub.calledOnce);
    const errorMsg = showErrorMessageStub.firstCall.args[0];
    assert.ok(errorMsg.startsWith("Failed to produce 1 message to topic"), errorMsg);
  });

  it("should pass `partition_id` and `timestamp` in the produce request if provided", async function () {
    const partition_id = 123;
    const timestamp = 1234567890;
    loadDocumentContentStub.resolves({
      content: JSON.stringify({ ...fakeMessage, partition_id, timestamp }),
    });
    clientStub.produceRecord.resolves({
      error_code: 200,
      timestamp: new Date(timestamp),
      partition_id,
    });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(clientStub.produceRecord.calledOnce);
    const requestArg: ProduceRecordRequest = clientStub.produceRecord.firstCall.args[0];
    assert.strictEqual(requestArg.ProduceRequest!.partition_id, partition_id);
    // timestamp should also be converted to a Date object
    assert.deepStrictEqual(requestArg.ProduceRequest!.timestamp, new Date(timestamp));
  });

  it("should handle optional fields independently", async function () {
    const partition_id = 123;
    const messageWithPartition = { ...fakeMessage, partition_id };
    loadDocumentContentStub.resolves({ content: JSON.stringify(messageWithPartition) });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(clientStub.produceRecord.calledOnce);
    const requestArg: ProduceRecordRequest = clientStub.produceRecord.firstCall.args[0];
    assert.strictEqual(requestArg.ProduceRequest!.partition_id, partition_id);
    assert.strictEqual(requestArg.ProduceRequest!.timestamp, undefined);
  });

  // `key` is an object that won't serialize to a string cleanly
  for (const key of [null, [], { foo: "bar" }]) {
    it(`should open message viewer without a 'textFilter' if the produce-message 'key' is not a primitive type or is null: ${JSON.stringify(key)} (${typeof key})`, async function () {
      loadDocumentContentStub.resolves({
        content: JSON.stringify({ ...fakeMessage, key }),
      });
      // user clicked the "View Message" button in the info notification
      showInfoMessageStub.resolves("View Message");

      clientStub.produceRecord.resolves({
        error_code: 200,
        timestamp: new Date(),
        partition_id: 0,
      });

      await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

      sinon.assert.calledOnce(clientStub.produceRecord);
      sinon.assert.calledOnce(showInfoMessageStub);
      sinon.assert.calledOnce(executeCommandStub);

      const commandArgs = executeCommandStub.firstCall.args;
      assert.strictEqual(commandArgs[0], "confluent.topic.consume");
      assert.strictEqual(commandArgs[1], TEST_LOCAL_KAFKA_TOPIC);
      assert.strictEqual(commandArgs[2], true);

      const mvConfig: MessageViewerConfig = commandArgs[3];
      assert.ok(mvConfig instanceof MessageViewerConfig);
      assert.strictEqual(mvConfig.textFilter, undefined);

      assert.ok(showErrorMessageStub.notCalled);
    });
  }

  for (const key of ["abc123", 456, true]) {
    it(`should open message viewer with a 'textFilter' if the produce-message 'key' is a primitive type: ${key} (${typeof key})`, async function () {
      loadDocumentContentStub.resolves({
        content: JSON.stringify({ ...fakeMessage, key }),
      });
      // user clicked the "View Message" button in the info notification
      showInfoMessageStub.resolves("View Message");

      clientStub.produceRecord.resolves({
        error_code: 200,
        timestamp: new Date(),
        partition_id: 0,
      });

      await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

      sinon.assert.calledOnce(clientStub.produceRecord);
      sinon.assert.calledOnce(showInfoMessageStub);
      sinon.assert.calledOnce(executeCommandStub);

      const commandArgs = executeCommandStub.firstCall.args;
      assert.strictEqual(commandArgs[0], "confluent.topic.consume");
      assert.strictEqual(commandArgs[1], TEST_LOCAL_KAFKA_TOPIC);
      assert.strictEqual(commandArgs[2], true);

      const mvConfig: MessageViewerConfig = commandArgs[3];
      assert.ok(mvConfig instanceof MessageViewerConfig);
      assert.strictEqual(mvConfig.textFilter, String(key));

      assert.ok(showErrorMessageStub.notCalled);
    });
  }
});

describe("commands/topics.ts produceMessageFromDocument() with schema(s)", function () {
  let sandbox: sinon.SinonSandbox;

  let loadDocumentContentStub: sinon.SinonStub;
  let schemaKindMultiSelectStub: sinon.SinonStub;
  let getSubjectNameStrategyStub: sinon.SinonStub;
  let promptForSchemaStub: sinon.SinonStub;

  let recordsV3ApiStub: sinon.SinonStubbedInstance<RecordsV3Api>;
  let ccloudProduceApiStub: sinon.SinonStubbedInstance<ConfluentCloudProduceRecordsResourceApi>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    sandbox.stub(vscode.window, "showErrorMessage");
    sandbox.stub(vscode.window, "showInformationMessage").resolves();

    // stub the quickpick for file/editor URI and the resulting content
    sandbox.stub(uriQuickpicks, "uriQuickpick").resolves(vscode.Uri.file("test.json"));
    loadDocumentContentStub = sandbox
      .stub(uriQuickpicks, "loadDocumentContent")
      .resolves({ content: JSON.stringify(fakeMessage) });

    schemaKindMultiSelectStub = sandbox.stub(schemaQuickPicks, "schemaKindMultiSelect");
    getSubjectNameStrategyStub = sandbox.stub(schemaSubjectUtils, "getSubjectNameStrategy");
    promptForSchemaStub = sandbox.stub(schemaUtils, "promptForSchema");

    // create the stubs for the sidecar + service clients
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    // non-CCloud:
    recordsV3ApiStub = sandbox.createStubInstance(RecordsV3Api);
    mockSidecarHandle.getRecordsV3Api.returns(recordsV3ApiStub);
    // CCloud:
    ccloudProduceApiStub = sandbox.createStubInstance(ConfluentCloudProduceRecordsResourceApi);
    mockSidecarHandle.getConfluentCloudProduceRecordsResourceApi.returns(ccloudProduceApiStub);

    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should exit early if schema kind selection is cancelled", async function () {
    schemaKindMultiSelectStub.resolves(undefined);

    // non-CCloud:
    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);
    // CCloud:
    await produceMessagesFromDocument(TEST_CCLOUD_KAFKA_TOPIC);

    sinon.assert.notCalled(getSubjectNameStrategyStub);
    sinon.assert.notCalled(promptForSchemaStub);
    sinon.assert.notCalled(
      ccloudProduceApiStub.gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost,
    );
  });

  it("should handle key schema only selection", async function () {
    // user only selected "Key Schema" in the multi-select quickpick
    schemaKindMultiSelectStub.resolves({
      keySchema: true,
      valueSchema: false,
      deferToDocument: false,
    });
    getSubjectNameStrategyStub.resolves(SubjectNameStrategy.TOPIC_NAME);
    promptForSchemaStub.resolves(TEST_LOCAL_KEY_SCHEMA);
    recordsV3ApiStub.produceRecord.resolves({
      error_code: 200,
      timestamp: new Date(),
      partition_id: 0,
    });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    sinon.assert.calledOnceWithExactly(getSubjectNameStrategyStub, TEST_LOCAL_KAFKA_TOPIC, "key");
    sinon.assert.calledOnceWithExactly(
      promptForSchemaStub,
      TEST_LOCAL_KAFKA_TOPIC,
      "key",
      SubjectNameStrategy.TOPIC_NAME,
    );
    sinon.assert.calledOnce(recordsV3ApiStub.produceRecord);
  });

  it("should handle value schema only selection", async function () {
    // user only selected "Value Schema" in the multi-select quickpick
    schemaKindMultiSelectStub.resolves({
      keySchema: false,
      valueSchema: true,
      deferToDocument: false,
    });
    getSubjectNameStrategyStub.resolves(SubjectNameStrategy.TOPIC_NAME);
    promptForSchemaStub.resolves(TEST_LOCAL_SCHEMA);
    recordsV3ApiStub.produceRecord.resolves({
      error_code: 200,
      timestamp: new Date(),
      partition_id: 0,
    });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(getSubjectNameStrategyStub.calledOnceWith(TEST_LOCAL_KAFKA_TOPIC, "value"));
    assert.ok(
      promptForSchemaStub.calledOnceWith(
        TEST_LOCAL_KAFKA_TOPIC,
        "value",
        SubjectNameStrategy.TOPIC_NAME,
      ),
    );
    assert.ok(recordsV3ApiStub.produceRecord.calledOnce);
  });

  it("should handle both key and value schema selection", async function () {
    // user selected both "key" and "value" in the multi-select quickpick
    schemaKindMultiSelectStub.resolves({
      keySchema: true,
      valueSchema: true,
      deferToDocument: false,
    });

    // setup stubs to return different values for different calls
    getSubjectNameStrategyStub
      .withArgs(TEST_LOCAL_KAFKA_TOPIC, "key")
      .resolves(SubjectNameStrategy.TOPIC_NAME);
    getSubjectNameStrategyStub
      .withArgs(TEST_LOCAL_KAFKA_TOPIC, "value")
      .resolves(SubjectNameStrategy.RECORD_NAME);

    promptForSchemaStub
      .withArgs(TEST_LOCAL_KAFKA_TOPIC, "key", SubjectNameStrategy.TOPIC_NAME)
      .resolves(TEST_LOCAL_KEY_SCHEMA);
    promptForSchemaStub
      .withArgs(TEST_LOCAL_KAFKA_TOPIC, "value", SubjectNameStrategy.RECORD_NAME)
      .resolves(TEST_LOCAL_SCHEMA);

    recordsV3ApiStub.produceRecord.resolves({
      error_code: 200,
      timestamp: new Date(),
      partition_id: 0,
    });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(getSubjectNameStrategyStub.calledWith(TEST_LOCAL_KAFKA_TOPIC, "key"));
    assert.ok(getSubjectNameStrategyStub.calledWith(TEST_LOCAL_KAFKA_TOPIC, "value"));
    assert.ok(
      promptForSchemaStub.calledWith(TEST_LOCAL_KAFKA_TOPIC, "key", SubjectNameStrategy.TOPIC_NAME),
    );
    assert.ok(
      promptForSchemaStub.calledWith(
        TEST_LOCAL_KAFKA_TOPIC,
        "value",
        SubjectNameStrategy.RECORD_NAME,
      ),
    );
    assert.ok(recordsV3ApiStub.produceRecord.calledOnce);
  });

  it("should handle the deferToDocument option", async function () {
    // user clicked "Advanced: Use File/Editor Contents"
    schemaKindMultiSelectStub.resolves({
      keySchema: false,
      valueSchema: false,
      deferToDocument: true,
    });

    const fakeMessageWithSchema: ProduceMessage = {
      ...fakeMessage,
      key_schema: {
        subject: "manual-key-subject",
        schema_version: 1,
        subject_name_strategy: SubjectNameStrategy.TOPIC_NAME,
      },
      value_schema: {
        subject: "manual-value-subject",
        schema_version: 2,
        subject_name_strategy: SubjectNameStrategy.TOPIC_NAME,
      },
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(fakeMessageWithSchema) });
    recordsV3ApiStub.produceRecord.resolves({
      error_code: 200,
      timestamp: new Date(),
      partition_id: 0,
    });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    // should not show schema quickpicks to user
    assert.ok(getSubjectNameStrategyStub.notCalled);
    assert.ok(promptForSchemaStub.notCalled);
    assert.ok(recordsV3ApiStub.produceRecord.calledOnce);
  });

  it("should handle errors in promptForSchema", async function () {
    schemaKindMultiSelectStub.resolves({
      keySchema: true,
      valueSchema: false,
      deferToDocument: false,
    });
    getSubjectNameStrategyStub.resolves(SubjectNameStrategy.TOPIC_NAME);
    // failure to find a schema
    promptForSchemaStub.rejects(new Error("No schema found"));

    // non-CCloud:
    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);
    // CCloud:
    await produceMessagesFromDocument(TEST_CCLOUD_KAFKA_TOPIC);

    // should exit early and not send the produce request
    sinon.assert.notCalled(recordsV3ApiStub.produceRecord);
    sinon.assert.notCalled(
      ccloudProduceApiStub.gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost,
    );
  });
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
      .stub(parsing, "getRangeForDocument")
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

describe("commands/topics.ts produceMessage()", function () {
  let sandbox: sinon.SinonSandbox;

  let recordsV3ApiStub: sinon.SinonStubbedInstance<RecordsV3Api>;
  let ccloudProduceApiStub: sinon.SinonStubbedInstance<ConfluentCloudProduceRecordsResourceApi>;

  const testSchemaOptions: ProduceMessageSchemaOptions = {
    keySchema: undefined,
    valueSchema: undefined,
    keySubjectNameStrategy: undefined,
    valueSubjectNameStrategy: undefined,
  };

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // create the stubs for the sidecar + service clients
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    // non-CCloud:
    recordsV3ApiStub = sandbox.createStubInstance(RecordsV3Api);
    mockSidecarHandle.getRecordsV3Api.returns(recordsV3ApiStub);
    // CCloud:
    ccloudProduceApiStub = sandbox.createStubInstance(ConfluentCloudProduceRecordsResourceApi);
    mockSidecarHandle.getConfluentCloudProduceRecordsResourceApi.returns(ccloudProduceApiStub);

    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should rethrow error 400 responses with JSON as ProduceMessageBadRequestErrors", async function () {
    const jsonBodyMsg = "Failed to parse data: ...";
    const errorResponse = new Response(
      JSON.stringify({
        message: jsonBodyMsg,
        error_code: 400,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );

    const responseError = new ResponseError(errorResponse);
    recordsV3ApiStub.produceRecord.rejects(responseError);

    await assert.rejects(
      async () => produceMessage(fakeMessage, TEST_LOCAL_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.ok(error instanceof ProduceMessageBadRequestError);
        assert.strictEqual(error.name, "ProduceMessageBadRequestError");
        assert.strictEqual(error.message, jsonBodyMsg);
        assert.strictEqual(error.response, responseError.response);
        return true;
      },
    );
  });

  it("should rethrow error 400 responses with text as ProduceMessageBadRequestErrors", async function () {
    const notJsonBody = "that doesn't match the schema";
    const errorResponse = new Response(notJsonBody, {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });

    const responseError = new ResponseError(errorResponse);
    recordsV3ApiStub.produceRecord.rejects(responseError);

    await assert.rejects(
      async () => produceMessage(fakeMessage, TEST_LOCAL_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.ok(error instanceof ProduceMessageBadRequestError);
        assert.strictEqual(error.name, "ProduceMessageBadRequestError");
        assert.strictEqual(error.message, notJsonBody);
        assert.strictEqual(error.response, responseError.response);
        return true;
      },
    );
  });

  // same as above, but with a different content type header
  it("should wrap 400 errors with invalid JSON as ProduceMessageBadRequestError", async function () {
    const notJsonBody = "oh no";
    const errorResponse = new Response(notJsonBody, {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const responseError = new ResponseError(errorResponse);
    recordsV3ApiStub.produceRecord.rejects(responseError);

    await assert.rejects(
      async () => produceMessage(fakeMessage, TEST_LOCAL_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.ok(error instanceof ProduceMessageBadRequestError);
        assert.strictEqual(error.name, "ProduceMessageBadRequestError");
        assert.strictEqual(error.message, notJsonBody);
        return true;
      },
    );
  });

  it("should rethrow non-400 ResponseErrors and not wrap as ProduceMessageBadRequestErrors", async function () {
    const errorResponse = new Response(
      JSON.stringify({ message: "Internal server error", error_code: 500 }),
      { status: 500 },
    );

    const responseError = new ResponseError(errorResponse);
    recordsV3ApiStub.produceRecord.rejects(responseError);

    await assert.rejects(
      async () => produceMessage(fakeMessage, TEST_LOCAL_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.strictEqual(error, responseError);
        assert.ok(!(error instanceof ProduceMessageBadRequestError));
        return true;
      },
    );
  });

  it("should re-throw non-ResponseError errors without wrapping", async function () {
    const otherError = new Error("oh no");
    recordsV3ApiStub.produceRecord.rejects(otherError);

    await assert.rejects(
      async () => produceMessage(fakeMessage, TEST_LOCAL_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.strictEqual(error, otherError);
        assert.ok(!(error instanceof ProduceMessageBadRequestError));
        return true;
      },
    );
  });

  it("should handle CCloud proxy response errors", async function () {
    const jsonBodyMsg = "Failed to parse data: ...";
    const errorResponse = new Response(JSON.stringify({ message: jsonBodyMsg }), { status: 400 });

    const responseError = new ResponseError(errorResponse);
    ccloudProduceApiStub.gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost.rejects(
      responseError,
    );

    await assert.rejects(
      async () => produceMessage(fakeMessage, TEST_CCLOUD_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.ok(error instanceof ProduceMessageBadRequestError);
        assert.strictEqual(error.name, "ProduceMessageBadRequestError");
        assert.strictEqual(error.message, jsonBodyMsg);
        return true;
      },
    );
  });

  it("should include the original request when wrapping as ProduceMessageBadRequestErrors", async function () {
    const contentWithSchema: ProduceMessage = {
      ...fakeMessage,
      key_schema: {
        subject: "test-key-subject",
        schema_version: 1,
        subject_name_strategy: SubjectNameStrategy.TOPIC_NAME,
      },
    };

    const errorResponse = new Response(JSON.stringify({ message: "Invalid key schema" }), {
      status: 400,
    });

    const responseError = new ResponseError(errorResponse);
    recordsV3ApiStub.produceRecord.rejects(responseError);

    await assert.rejects(
      async () => produceMessage(contentWithSchema, TEST_LOCAL_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.ok(error instanceof ProduceMessageBadRequestError);
        assert.ok(error.request.key);
        assert.ok(error.request.key.subject_name_strategy);
        assert.strictEqual(error.request.key.subject_name_strategy, SubjectNameStrategy.TOPIC_NAME);
        return true;
      },
    );
  });

  it("should handle empty responses in error handling", async function () {
    // empty error response
    const errorResponse = new Response("", { status: 400 });

    const responseError = new ResponseError(errorResponse);
    recordsV3ApiStub.produceRecord.rejects(responseError);

    await assert.rejects(
      async () => produceMessage(fakeMessage, TEST_LOCAL_KAFKA_TOPIC, testSchemaOptions),
      (error) => {
        assert.ok(error instanceof ProduceMessageBadRequestError);
        assert.strictEqual(error.message, "");
        return true;
      },
    );
  });
});
