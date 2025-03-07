import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { SchemaType } from "../models/schema";
import * as quickPicksSchemas from "../quickpicks/schemas";
import {
  chooseSubject,
  determineSchemaType,
  extractDetail,
  parseConflictMessage,
  schemaFromString,
  schemaRegistrationMessage,
  validateNewSubject,
} from "./schemaUpload";

import { TEST_LOCAL_SCHEMA_REGISTRY } from "../../tests/unit/testResources";
import { TEST_CCLOUD_SCHEMA } from "../../tests/unit/testResources/schema";

describe("commands/schemaUpload.ts determineSchemaType tests", function () {
  let sandbox: sinon.SinonSandbox;
  let schemaTypeQuickPickStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    schemaTypeQuickPickStub = sandbox
      .stub(quickPicksSchemas, "schemaTypeQuickPick")
      .resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should successfully determine schema type from file URI", async () => {
    // for pair of (file extension, expected schema type) from array of string pairs ...
    for (const [fileExtension, expectedSchemaType] of [
      ["avsc", SchemaType.Avro],
      ["proto", SchemaType.Protobuf],
    ]) {
      const fileUri = vscode.Uri.file(`some-file.${fileExtension}`);
      const schemaType = await determineSchemaType(fileUri);

      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${fileExtension}, got ${schemaType} instead`,
      );
      assert.ok(schemaTypeQuickPickStub.notCalled);
    }
  });

  it("should show the schema type quickpick when unable to determine the schema type from the provided Uri and language ID", async () => {
    const fileUri = vscode.Uri.file("some-file.txt");
    await determineSchemaType(fileUri, "plaintext");

    assert.ok(schemaTypeQuickPickStub.calledOnce);
  });

  it("should show the schema type quickpick when the provided Uri has a JSON file extension and language ID", async () => {
    // first, simulate the user cancelling the quickpick
    schemaTypeQuickPickStub.resolves(undefined);
    const fileUri = vscode.Uri.file("some-file.json");
    const result = await determineSchemaType(fileUri, "json");

    assert.ok(schemaTypeQuickPickStub.calledOnce);
    assert.strictEqual(result, undefined);

    // next, simulate the user selecting the JSON option
    schemaTypeQuickPickStub.resolves("JSON");
    const nextResult = await determineSchemaType(fileUri, "json");

    assert.ok(schemaTypeQuickPickStub.calledTwice);
    assert.strictEqual(nextResult, SchemaType.Json);
  });

  it("should successfully determine schema type from a valid provided language ID when failing to determine from file/editor Uri", async () => {
    for (const [languageId, expectedSchemaType] of [
      ["avroavsc", SchemaType.Avro],
      ["proto", SchemaType.Protobuf],
      ["proto3", SchemaType.Protobuf],
    ]) {
      const fileUri = vscode.Uri.file("some-file.txt");
      const schemaType = await determineSchemaType(fileUri, languageId);

      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given ${languageId}, got ${schemaType} instead`,
      );
      assert.ok(schemaTypeQuickPickStub.notCalled);
    }
  });

  it("should successfully determine schema type from language ID when file URI has an ambiguous file extension", async () => {
    for (const [languageId, expectedSchemaType] of [
      ["avroavsc", "AVRO"],
      ["proto", "PROTOBUF"],
    ]) {
      // unhelpful file extension
      const fileUri = vscode.Uri.file(`some-file.txt`);
      const schemaType = await determineSchemaType(fileUri, languageId);

      assert.strictEqual(
        schemaType,
        expectedSchemaType,
        `Expected ${expectedSchemaType} given .txt and ${languageId}, got ${schemaType} instead`,
      );
      assert.ok(schemaTypeQuickPickStub.notCalled);
    }
  });

  it("should return undefined when a schema type can't be determined from the Uri, no language ID is passed, and the user cancels the quickpick", async () => {
    // simulate the user cancelling the quickpick
    schemaTypeQuickPickStub.resolves(undefined);
    const fileUri = vscode.Uri.file("some-file.txt");

    const result = await determineSchemaType(fileUri);

    assert.strictEqual(result, undefined);
  });
});

describe("commands/schemaUpload.ts schemaRegistrationMessage tests", function () {
  it("new subject registration message is correct", () => {
    const subject = "MyTopic-value";
    const message = schemaRegistrationMessage(subject, undefined, 1);
    assert.equal(message, `Schema registered to new subject "${subject}"`);
  });

  it("existing subject registration message is correct", () => {
    const subject = "MyTopic-value";
    const oldVersion = 1;
    const newVersion = 2;
    const message = schemaRegistrationMessage(subject, oldVersion, newVersion);
    assert.strictEqual(
      message,
      `New version ${newVersion} registered to existing subject "${subject}"`,
    );
  });

  it("normalized to existing version message is correct when normalized to most recent version", () => {
    const subject = "MyTopic-value";
    const version = 1;
    const message = schemaRegistrationMessage(subject, version, version);
    assert.strictEqual(
      message,
      `Normalized to existing version ${version} for subject "${subject}"`,
    );
  });

  it("normalized to existing version message is correct when normalized to older version", () => {
    const subject = "MyTopic-value";
    const thisVersion = 1;
    const maxVersion = 2;
    const message = schemaRegistrationMessage(subject, maxVersion, thisVersion);
    assert.strictEqual(
      message,
      `Normalized to existing version ${thisVersion} for subject "${subject}"`,
    );
  });
});

describe("commands/schemaUpload.ts extractDetail tests", () => {
  for (const [instance, message, expectedResult] of [
    ["one details", 'blah blah details: "this is a test"', '"this is a test"'],
    ["no details", "blah blah", "blah blah"],
    ["multiple details", 'details: "one", details: "two"', '"two"'],
  ]) {
    it(`extractDetail successfully extracts detail from case ${instance}`, () => {
      const detail = extractDetail(message);
      assert.strictEqual(detail, expectedResult);
    });
  }
});

describe("commands/schemaUpload.ts parseConflictMessage tests", () => {
  for (const [instance, schemaType, message, expectedResult] of [
    [
      "Avro with embedded single quotes",
      SchemaType.Avro,
      "blah blah details: \"blah description:'yo 'mama' is a test', additionalInfo: \"blah\"",
      "yo 'mama' is a test",
    ],
    [
      "Avro without embedded single quotes",
      SchemaType.Avro,
      'blah blah details: "blah description:\'this is a test\', additionalInfo: "blah"',
      "this is a test",
    ],
    [
      "Protobuf",
      SchemaType.Protobuf,
      'blah blah details: "blah {description:"this is a test"}, ...',
      "this is a test",
    ],
    [
      "JSON with ending single quote",
      SchemaType.Json,
      'blah blah details: "blah {description:"this is a test\'}, ...',
      "this is a test",
    ],
    [
      "JSON with ending double quote",
      SchemaType.Json,
      'blah blah details: "blah {description:"this is a test"}, ...',
      "this is a test",
    ],
    [
      "Unexpected format, should return all after details",
      SchemaType.Avro,
      "blah blah details: stuff goes here",
      "stuff goes here",
    ],
  ]) {
    it(`parseConflictMessage successfully extracts detail from case ${instance}`, () => {
      const detail = parseConflictMessage(schemaType as SchemaType, message);
      assert.strictEqual(detail, expectedResult);
    });
  }
});

describe("schemaFromString tests", () => {
  it("Should return a schema object with the correct values", () => {
    const schemaString = JSON.stringify(TEST_CCLOUD_SCHEMA);
    const schema = schemaFromString(schemaString);
    assert.deepStrictEqual(schema, TEST_CCLOUD_SCHEMA);
  });

  it("should return undefined when the schema string is invalid json", () => {
    const badSchemaString = "invalid schema string";
    const schema = schemaFromString(badSchemaString);
    assert.strictEqual(schema, undefined);
  });

  it("should return undefined when the schema string is json but does not describe a schema", () => {
    const badSchemaString = '{"foo": "bar"}';
    const schema = schemaFromString(badSchemaString);
    assert.strictEqual(schema, undefined);
  });
});

describe("commands/schemaUpload.ts chooseSubject()", () => {
  let sandbox: sinon.SinonSandbox;
  let schemaSubjectQuickPickStub: sinon.SinonStub;
  let showInputBoxStub: sinon.SinonStub;

  // doesn't matter which SR; we just need one for chooseSubject() to pass to schemaSubjectQuickPick()
  const registry = TEST_LOCAL_SCHEMA_REGISTRY;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    schemaSubjectQuickPickStub = sandbox.stub(quickPicksSchemas, "schemaSubjectQuickPick");
    showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return the selected subject when an existing subject is chosen", async () => {
    const existingSubject = "test-subject-value";
    schemaSubjectQuickPickStub.resolves(existingSubject);

    const result: string | undefined = await chooseSubject(registry);

    assert.strictEqual(result, existingSubject);
    sinon.assert.calledOnce(schemaSubjectQuickPickStub);
    sinon.assert.notCalled(showInputBoxStub);
  });

  it("should prompt for a new subject name when creating a new subject", async () => {
    // user selects "Create new subject"
    schemaSubjectQuickPickStub.resolves("");
    // user enters a new subject name
    const newSubject = "new-subject-value";
    showInputBoxStub.resolves(newSubject);

    const result: string | undefined = await chooseSubject(registry);

    assert.strictEqual(result, newSubject);
    sinon.assert.calledOnce(schemaSubjectQuickPickStub);
    sinon.assert.calledOnce(showInputBoxStub);
  });

  it("should return undefined when the subject quickpick is canceled", async () => {
    schemaSubjectQuickPickStub.resolves(undefined); // User cancels selection

    const result: string | undefined = await chooseSubject(registry);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(schemaSubjectQuickPickStub);
    sinon.assert.notCalled(showInputBoxStub);
  });

  it("should return undefined when new-subject input is canceled", async () => {
    // user selects "Create new subject"
    schemaSubjectQuickPickStub.resolves("");
    // ...but cancels the input box
    showInputBoxStub.resolves(undefined);

    const result: string | undefined = await chooseSubject(registry);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(schemaSubjectQuickPickStub);
    sinon.assert.calledOnce(showInputBoxStub);
  });
});

describe("commands/schemaUpload.ts validateNewSubject", () => {
  it("should return undefined for a subject name ending with '-key'", () => {
    const result: vscode.InputBoxValidationMessage | undefined =
      validateNewSubject("test-topic-key");
    assert.strictEqual(result, undefined);
  });

  it("should return undefined for a subject name ending with '-value'", () => {
    const result: vscode.InputBoxValidationMessage | undefined =
      validateNewSubject("test-topic-value");
    assert.strictEqual(result, undefined);
  });

  it("should return a warning for subject names not ending with '-key' or '-value'", () => {
    const result: vscode.InputBoxValidationMessage | undefined = validateNewSubject("test-topic");

    assert.ok(result);
    assert.strictEqual(result?.severity, vscode.InputBoxValidationSeverity.Warning);
    assert.ok(result?.message.includes("will not match the [TopicNameStrategy]"));
  });
});
