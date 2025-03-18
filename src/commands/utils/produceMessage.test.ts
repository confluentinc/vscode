import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_LOCAL_SCHEMA } from "../../../tests/unit/testResources";
import { TEST_DIRECT_CONNECTION_FORM_SPEC } from "../../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { Schema } from "../../models/schema";
import { SchemaInfo, SubjectNameStrategy } from "../../schemas/produceMessageSchema";
import { CustomConnectionSpec, getResourceManager } from "../../storage/resourceManager";
import { createProduceRequestData, extractSchemaInfo } from "./produceMessage";

describe("commands/utils/produceMessage.ts createProduceRequestData()", function () {
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

  it("should nest key/value data under keyData.data and valueData.data", async function () {
    const result = await createProduceRequestData({
      key: "test-key",
      value: "test-value",
    });

    assert.deepStrictEqual(result, {
      keyData: {
        data: "test-key",
      },
      valueData: {
        data: "test-value",
      },
    });
  });

  it("should create request data without 'type' for direct connection topics", async function () {
    // even if it's a CCloud direct connection, we don't want to set 'type' since the sidecar will
    // send it directly to the Kafka cluster instead of through the REST proxy
    const fakeSpec: CustomConnectionSpec = {
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      formConnectionType: "Confluent Cloud",
    };
    getDirectConnectionStub.resolves(fakeSpec);

    const result = await createProduceRequestData({
      key: "test-key",
      value: "test-value",
    });

    assert.deepStrictEqual(result, {
      keyData: {
        data: "test-key",
      },
      valueData: {
        data: "test-value",
      },
    });
  });
});

describe("commands/utils/produceMessage.ts extractSchemaInfo()", function () {
  it("should extract schema info from provided file/document message content", function () {
    const docContentSchemaInfo: SchemaInfo = {
      subject: "test-subject",
      schema_version: 3,
      subject_name_strategy: SubjectNameStrategy.TOPIC_RECORD_NAME,
    };

    const result: SchemaInfo | undefined = extractSchemaInfo(
      docContentSchemaInfo,
      undefined,
      undefined,
    );

    assert.deepStrictEqual(result, {
      subject: docContentSchemaInfo.subject,
      schema_version: docContentSchemaInfo.schema_version,
      subject_name_strategy: docContentSchemaInfo.subject_name_strategy,
    });
  });

  it("should extract schema info from a quickpicked Schema object", function () {
    const result: SchemaInfo | undefined = extractSchemaInfo(
      undefined,
      TEST_LOCAL_SCHEMA,
      SubjectNameStrategy.TOPIC_NAME,
    );

    assert.deepStrictEqual(result, {
      subject: TEST_LOCAL_SCHEMA.subject,
      schema_version: TEST_LOCAL_SCHEMA.version,
      subject_name_strategy: SubjectNameStrategy.TOPIC_NAME,
    });
  });

  it("should favor document-content schema info over quickpicked Schema object", function () {
    // if the user goes through the quickpick flow to choose a schema subject but they still have
    // schema information in the document, use the document info
    const docContentSchemaInfo: SchemaInfo = {
      subject: "provided-subject",
      schema_version: 2,
      subject_name_strategy: SubjectNameStrategy.RECORD_NAME,
    };
    const quickPickSchema: Schema = TEST_LOCAL_SCHEMA;

    const result = extractSchemaInfo(
      docContentSchemaInfo,
      quickPickSchema,
      SubjectNameStrategy.TOPIC_NAME,
    );

    assert.deepStrictEqual(result, {
      subject: docContentSchemaInfo.subject,
      schema_version: docContentSchemaInfo.schema_version,
      subject_name_strategy: docContentSchemaInfo.subject_name_strategy,
    });
  });

  it("should return undefined if no schema info was provided", function () {
    const result: SchemaInfo | undefined = extractSchemaInfo(undefined, undefined, undefined);

    assert.strictEqual(result, undefined);
  });
});
