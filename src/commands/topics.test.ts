import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { TEST_DIRECT_CONNECTION_FORM_SPEC } from "../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ProduceRecordRequest, RecordsV3Api, ResponseError } from "../clients/kafkaRest";
import * as quickpicks from "../quickpicks/uris";
import * as sidecar from "../sidecar";
import { CustomConnectionSpec, getResourceManager } from "../storage/resourceManager";
import { createProduceRequestData, produceMessagesFromDocument } from "./topics";

const fakeMessage = {
  key: "test-key",
  value: "test-value",
  headers: [{ key: "test-header", value: "test-header-value" }],
};

describe("commands/topics.ts produceMessageFromDocument()", function () {
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
      .stub(quickpicks, "uriQuickpick")
      .resolves(vscode.Uri.file("test.json"));
    loadDocumentContentStub = sandbox
      .stub(quickpicks, "loadDocumentContent")
      .resolves({ content: JSON.stringify(fakeMessage) });

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
    assert.ok(errorMsg.startsWith("Error while trying to produce message"), errorMsg);
  });

  it("should show an error notification for any nested error_code>=400 responses", async function () {
    // response will show status 200, but the error is nested in the response body
    clientStub.produceRecord.resolves({
      error_code: 422,
      message: "uh oh",
      timestamp: new Date(),
      partition_id: 0,
    });

    await produceMessagesFromDocument(TEST_LOCAL_KAFKA_TOPIC);

    assert.ok(showErrorMessageStub.calledOnce);
    const errorMsg = showErrorMessageStub.firstCall.args[0];
    assert.ok(errorMsg.startsWith("Error while trying to produce message"));
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
    assert.strictEqual(requestArg.ProduceRequest!.timestamp, timestamp);
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

describe("commands/topics.ts createProduceRequestData()", function () {
  let sandbox: sinon.SinonSandbox;
  let getDirectConnectionStub: sinon.SinonStub;

  before(async function () {
    await getTestExtensionContext();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    getDirectConnectionStub = sandbox.stub(getResourceManager(), "getDirectConnection");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should create request data with 'type' set for CCloud topics", async function () {
    const result = await createProduceRequestData(
      TEST_CCLOUD_KAFKA_TOPIC,
      "test-key",
      "test-value",
    );

    assert.deepStrictEqual(result, {
      keyData: {
        type: "JSON",
        data: "test-key",
      },
      valueData: {
        type: "JSON",
        data: "test-value",
      },
    });
  });

  it("should create request data without 'type' for local topics", async function () {
    const result = await createProduceRequestData(TEST_LOCAL_KAFKA_TOPIC, "test-key", "test-value");

    assert.deepStrictEqual(result, {
      keyData: {
        data: "test-key",
      },
      valueData: {
        data: "test-value",
      },
    });
  });

  it("should create request data with 'type' set for direct connections with the 'Confluent Cloud' form type", async function () {
    const fakeSpec: CustomConnectionSpec = {
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      formConnectionType: "Confluent Cloud",
    };
    getDirectConnectionStub.resolves(fakeSpec);

    const result = await createProduceRequestData(
      TEST_DIRECT_KAFKA_TOPIC,
      "test-key",
      "test-value",
    );

    assert.deepStrictEqual(result, {
      keyData: {
        type: "JSON",
        data: "test-key",
      },
      valueData: {
        type: "JSON",
        data: "test-value",
      },
    });
  });
});
