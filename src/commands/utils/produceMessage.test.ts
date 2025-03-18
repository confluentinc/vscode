import * as assert from "assert";
import { TEST_LOCAL_KEY_SCHEMA, TEST_LOCAL_SCHEMA } from "../../../tests/unit/testResources";
import { Schema } from "../../models/schema";
import { SchemaInfo, SubjectNameStrategy } from "../../schemas/produceMessageSchema";
import { createProduceRequestData, extractSchemaInfo } from "./produceMessage";
import { ProduceMessageSchemaOptions } from "./types";

describe("commands/utils/produceMessage.ts createProduceRequestData()", function () {
  it("should nest key/value data under keyData.data and valueData.data", async function () {
    const result = await createProduceRequestData({
      key: "test-key",
      value: "test-value",
    });

    assert.deepStrictEqual(result, {
      keyData: { data: "test-key" },
      valueData: { data: "test-value" },
    });
  });

  it("should include schema info in keyData/valueData when passed", async function () {
    const schemaOptions: ProduceMessageSchemaOptions = {
      keySchema: TEST_LOCAL_KEY_SCHEMA,
      keySubjectNameStrategy: SubjectNameStrategy.TOPIC_RECORD_NAME,
      valueSchema: TEST_LOCAL_SCHEMA,
      valueSubjectNameStrategy: SubjectNameStrategy.TOPIC_NAME,
    };
    const result = await createProduceRequestData(
      {
        key: "test-key",
        value: "test-value",
      },
      schemaOptions,
    );

    assert.deepStrictEqual(result, {
      keyData: {
        data: "test-key",
        subject: TEST_LOCAL_KEY_SCHEMA.subject,
        schema_version: TEST_LOCAL_KEY_SCHEMA.version,
        subject_name_strategy: SubjectNameStrategy.TOPIC_RECORD_NAME,
      },
      valueData: {
        data: "test-value",
        subject: TEST_LOCAL_SCHEMA.subject,
        schema_version: TEST_LOCAL_SCHEMA.version,
        subject_name_strategy: SubjectNameStrategy.TOPIC_NAME,
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
