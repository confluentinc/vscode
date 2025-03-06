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
import * as schemaQuickPicks from "../quickpicks/schemas";
import * as uriQuickpicks from "../quickpicks/uris";
import * as schemaSubjectUtils from "../quickpicks/utils/schemaSubjects";
import * as schemaUtils from "../quickpicks/utils/schemas";
import { ProduceMessage, SubjectNameStrategy } from "../schemas/produceMessageSchema";
import * as sidecar from "../sidecar";
import { produceMessagesFromDocument } from "./topics";

const fakeMessage = {
  key: "test-key",
  value: "test-value",
  headers: [{ key: "test-header", value: "test-header-value" }],
};

describe("commands/topics.ts produceMessageFromDocument() without schemas", function () {
  let sandbox: sinon.SinonSandbox;

  let showErrorMessageStub: sinon.SinonStub;

  let uriQuickpickStub: sinon.SinonStub;
  let loadDocumentContentStub: sinon.SinonStub;

  let clientStub: sinon.SinonStubbedInstance<RecordsV3Api>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");

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
    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(clientStub.produceRecord.calledOnce);
    assert.ok(showInfoStub.calledOnce);
    const successMsg = showInfoStub.firstCall.args[0];
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
