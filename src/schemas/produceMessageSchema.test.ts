import * as assert from "assert";
import * as sinon from "sinon";
import { Diagnostic, DiagnosticSeverity, Uri } from "vscode";
import * as uris from "../quickpicks/uris";
import { JSON_DIAGNOSTIC_COLLECTION } from "./diagnosticCollection";
import {
  PRODUCE_MESSAGE_SCHEMA,
  ProduceMessage,
  SchemaInfo,
  SubjectNameStrategy,
} from "./produceMessageSchema";
import { validateDocument } from "./validateDocument";

const BASIC_MESSAGE: ProduceMessage = {
  key: "foo",
  value: "bar",
};

const BASIC_SCHEMA_INFO: SchemaInfo = {
  schema_version: 1,
  subject: "test-key",
  subject_name_strategy: SubjectNameStrategy.TOPIC_NAME,
};

describe("schemas/produceMessageSchema validation", function () {
  let sandbox: sinon.SinonSandbox;
  let loadDocumentContentStub: sinon.SinonStub;

  const fakeUri = Uri.file("test");

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // stub the loadDocumentContent function to return fake content from a document
    loadDocumentContentStub = sandbox.stub(uris, "loadDocumentContent");
  });

  afterEach(function () {
    // clear the diagnostics collection after each test
    JSON_DIAGNOSTIC_COLLECTION.clear();
    sandbox.restore();
  });

  it("should not set any diagnostics for a valid (single) message", async function () {
    loadDocumentContentStub.resolves({ content: JSON.stringify(BASIC_MESSAGE) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 0);
  });

  it("should not set any diagnostics for a valid array of messages", async function () {
    loadDocumentContentStub.resolves({ content: JSON.stringify([BASIC_MESSAGE, BASIC_MESSAGE]) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 0);
  });

  it("should set a diagnostic for an empty file", async function () {
    loadDocumentContentStub.resolves({ content: "" });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, "No JSON content found in document.");
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
  });

  for (const missingField of ["key", "value"]) {
    it(`should set an error diagnostic for a message with no \`${missingField}\``, async function () {
      const invalidMessage = {
        [missingField === "key" ? "value" : "key"]: "foo",
      };
      loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

      await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

      const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message, `Missing property "${missingField}".`);
      assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
    });
  }

  it("should set an error diagnostic for a header with no `key`/`name`", async function () {
    const invalidMessage = {
      ...BASIC_MESSAGE,
      headers: [{ value: "qux" }],
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, `Missing property "key".`);
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
  });

  it("should set an error diagnostic for headers with non-string values", async function () {
    const invalidMessage = {
      ...BASIC_MESSAGE,
      headers: [{ key: "foo", value: 123 }], // numeric value instead of string
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.ok(diagnostics[0].message.includes("string"));
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
  });

  it("should set error diagnostics for invalid JSON", async function () {
    loadDocumentContentStub.resolves({ content: "{key: invalid json}" });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 3);
    const diagnosticMessages = diagnostics.map((d) => d.message);
    assert.ok(diagnosticMessages.includes("Property keys must be doublequoted"));
    assert.ok(diagnosticMessages.includes("Value expected"));
    // this one is weird, but because the spec defines the array of objects first, it's going to
    // say it needs to be an array if it can't validate for either the array or the object
    assert.ok(diagnosticMessages.includes(`Incorrect type. Expected "array".`));
  });

  it("should set an error diagnostic for an empty array", async function () {
    loadDocumentContentStub.resolves({ content: "[]" });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, "Array has too few items. Expected 1 or more.");
  });

  it("should not set any diagnostics for valid optional fields", async function () {
    const messageWithOptionals = {
      ...BASIC_MESSAGE,
      partition_id: 1,
      timestamp: 1234567890,
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(messageWithOptionals) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 0);
  });

  for (const field of ["partition_id", "timestamp"]) {
    it(`should set an error diagnostic for non-integer \`${field}\``, async function () {
      const invalidMessage = {
        ...BASIC_MESSAGE,
        [field]: "oh no",
      };
      loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

      await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

      const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message, `Incorrect type. Expected "integer".`);
      assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
    });
  }

  it("should not set any diagnostics for valid schema properties", async function () {
    const messageWithSchemas = {
      ...BASIC_MESSAGE,
      key_schema: BASIC_SCHEMA_INFO,
      value_schema: {
        ...BASIC_SCHEMA_INFO,
        subject: "test-value",
      },
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(messageWithSchemas) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 0);
  });

  it("should set an error diagnostic for missing required fields in `*_schema` property", async function () {
    const invalidMessage = {
      ...BASIC_MESSAGE,
      key_schema: {
        ...BASIC_SCHEMA_INFO,
        schema_version: undefined, // missing required field
      },
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, `Missing property "schema_version".`);
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
  });

  it("should set an error diagnostic for invalid `subject_name_strategy` value", async function () {
    const invalidMessage = {
      ...BASIC_MESSAGE,
      key_schema: {
        ...BASIC_SCHEMA_INFO,
        subject_name_strategy: "INVALID_STRATEGY", // invalid enum value
      },
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.ok(diagnostics[0].message.includes("Value is not accepted. Valid values:"));
    assert.ok(diagnostics[0].message.includes(SubjectNameStrategy.TOPIC_NAME));
    assert.ok(diagnostics[0].message.includes(SubjectNameStrategy.TOPIC_RECORD_NAME));
    assert.ok(diagnostics[0].message.includes(SubjectNameStrategy.RECORD_NAME));
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
  });

  it("should set an error diagnostic for invalid `schema_version` value type", async function () {
    const invalidMessage = {
      ...BASIC_MESSAGE,
      key_schema: {
        ...BASIC_SCHEMA_INFO,
        schema_version: "1", // string instead of integer
      },
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = JSON_DIAGNOSTIC_COLLECTION.get(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, `Incorrect type. Expected "integer".`);
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
  });
});
