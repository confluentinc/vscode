import * as assert from "assert";
import * as sinon from "sinon";
import { env, InputBoxValidationMessage, InputBoxValidationSeverity, Uri, window } from "vscode";

import {
  getStubbedCCloudResourceLoader,
  getStubbedResourceLoader,
} from "../../../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REGISTRY,
  TEST_LOCAL_SUBJECT_WITH_SCHEMAS,
} from "../../../../tests/unit/testResources";
import { CCloudResourceLoader, LocalResourceLoader, ResourceLoader } from "../../../loaders";
import { type Schema, SchemaType, Subject } from "../../../models/schema";
import { type SchemaRegistry } from "../../../models/schemaRegistry";
import { KafkaTopic } from "../../../models/topic";
import * as quickPicksSchemas from "../../../quickpicks/schemas";
import { copySubjectCommand } from "../../schemas";
import {
  CannotLoadSchemasError,
  chooseSubject,
  determineLatestSchema,
  determineSchemaType,
  extractDetail,
  getLatestSchemasForTopic,
  parseConflictMessage,
  schemaFromString,
  schemaRegistrationMessage,
  validateNewSubject,
} from "./upload";

describe("commands/utils/schemaManagement/upload.ts determineSchemaType()", function () {
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
      const fileUri = Uri.file(`some-file.${fileExtension}`);
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
    const fileUri = Uri.file("some-file.txt");
    await determineSchemaType(fileUri, "plaintext");

    assert.ok(schemaTypeQuickPickStub.calledOnce);
  });

  it("should show the schema type quickpick when the provided Uri has a JSON file extension and language ID", async () => {
    // first, simulate the user cancelling the quickpick
    schemaTypeQuickPickStub.resolves(undefined);
    const fileUri = Uri.file("some-file.json");
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
      const fileUri = Uri.file("some-file.txt");
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
      const fileUri = Uri.file(`some-file.txt`);
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
    const fileUri = Uri.file("some-file.txt");

    const result = await determineSchemaType(fileUri);

    assert.strictEqual(result, undefined);
  });
});

describe("commands/utils/schemaManagement/upload.ts schemaRegistrationMessage()", function () {
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

describe("commands/utils/schemaManagement/upload.ts extractDetail()", () => {
  for (const [instance, message, expectedResult] of [
    ["one details", 'blah blah details: "this is a test"', '"this is a test"'],
    ["no details", "blah blah", "blah blah"],
    ["multiple details", 'details: "one", details: "two"', '"two"'],
  ]) {
    it(`should successfully extract detail from case ${instance}`, () => {
      const detail = extractDetail(message);
      assert.strictEqual(detail, expectedResult);
    });
  }
});

describe("commands/utils/schemaManagement/upload.ts parseConflictMessage()", () => {
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

describe("commands/utils/schemaManagement/upload.ts schemaFromString()", () => {
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

describe("commands/utils/schemaManagement/upload.ts chooseSubject()", () => {
  let sandbox: sinon.SinonSandbox;
  let schemaSubjectQuickPickStub: sinon.SinonStub;
  let showInputBoxStub: sinon.SinonStub;

  // doesn't matter which SR; we just need one for chooseSubject() to pass to schemaSubjectQuickPick()
  const registry = TEST_LOCAL_SCHEMA_REGISTRY;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    schemaSubjectQuickPickStub = sandbox.stub(quickPicksSchemas, "schemaSubjectQuickPick");
    showInputBoxStub = sandbox.stub(window, "showInputBox");
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

describe("commands/utils/schemaManagement/upload.ts validateNewSubject()", () => {
  it("should return undefined for a subject name ending with '-key'", () => {
    const result: InputBoxValidationMessage | undefined = validateNewSubject("test-topic-key");
    assert.strictEqual(result, undefined);
  });

  it("should return undefined for a subject name ending with '-value'", () => {
    const result: InputBoxValidationMessage | undefined = validateNewSubject("test-topic-value");
    assert.strictEqual(result, undefined);
  });

  it("should return a warning for subject names not ending with '-key' or '-value'", () => {
    const result: InputBoxValidationMessage | undefined = validateNewSubject("test-topic");

    assert.ok(result);
    assert.strictEqual(result?.severity, InputBoxValidationSeverity.Warning);
    assert.ok(result?.message.includes("will not match the [TopicNameStrategy]"));
  });
});

describe("commands/utils/schemaManagement/upload.ts copySubject", () => {
  let _originalClipboardContents: string | undefined;

  beforeEach(async () => {
    _originalClipboardContents = await env.clipboard.readText();
  });

  afterEach(async () => {
    if (_originalClipboardContents !== undefined) {
      await env.clipboard.writeText(_originalClipboardContents);
    }
  });

  it("should copy the subject name to the clipboard", async () => {
    await copySubjectCommand(TEST_CCLOUD_SUBJECT);
    const writtenValue = await env.clipboard.readText();
    assert.strictEqual(writtenValue, TEST_CCLOUD_SUBJECT.name);
  });
});

// Run one set of tests for the local resource loader and another for the CCloud resource loader
describe(
  "commands/schemas.ts getLatestSchemasForTopic vs local registry tests",
  generateGetLatestSchemasForTopicTests(
    LocalResourceLoader,
    TEST_LOCAL_KAFKA_TOPIC,
    TEST_LOCAL_SCHEMA,
    TEST_LOCAL_SCHEMA_REGISTRY,
  ),
);

describe(
  "commands/schemas.ts getLatestSchemasForTopic vs CCloud registry tests",
  generateGetLatestSchemasForTopicTests(
    CCloudResourceLoader,
    TEST_CCLOUD_KAFKA_TOPIC,
    TEST_CCLOUD_SCHEMA,
    TEST_CCLOUD_SCHEMA_REGISTRY,
  ),
);

/** Generic function used to generate same tests over getLatestSchemasForTopic() for varying ResourceLoaders */
function generateGetLatestSchemasForTopicTests<
  ResourceLoaderType extends ResourceLoader,
  SchemaRegistryType extends SchemaRegistry,
>(
  resourceLoaderClass: Constructor<ResourceLoaderType>,
  baseTopic: KafkaTopic,
  testSchema: Schema,
  baseSchemaRegistry: SchemaRegistryType,
): () => void {
  return function () {
    let sandbox: sinon.SinonSandbox;

    let stubbedLoader: sinon.SinonStubbedInstance<ResourceLoaderType>;
    let testTopic: KafkaTopic;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      stubbedLoader = getStubbedResourceLoader(
        sandbox,
      ) as sinon.SinonStubbedInstance<ResourceLoaderType>;

      // Ensure that testTopic smells like it has a schema and is named "test-topic", the default expectation of these tests.
      testTopic = KafkaTopic.create({ ...baseTopic, hasSchema: true, name: "test-topic" });
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("hates topics without schemas", async function () {
      await assert.rejects(
        async () => {
          await getLatestSchemasForTopic(KafkaTopic.create({ ...testTopic, hasSchema: false }));
        },
        raisedErrorMatcher(
          /Asked to get schemas for topic "test-topic" believed to not have schema/,
        ),
      );
    });

    it("hates topics without subject groups", async function () {
      stubbedLoader.getTopicSubjectGroups.resolves([]);
      await assert.rejects(
        async () => {
          await getLatestSchemasForTopic(testTopic);
        },
        raisedCannotLoadSchemasErrorMatcher(
          /Topic "test-topic" has no related schemas in registry/,
        ),
      );
    });

    it("loves and returns highest versioned schemas for topic with key and value topics", async function () {
      stubbedLoader.getSchemaRegistryForEnvironmentId.resolves(baseSchemaRegistry);

      // Doesn't really matter that we're mixing local and CCloud here, just wanting to test returning
      // multiple subjects with multiple schemas each.
      stubbedLoader.getTopicSubjectGroups.resolves([
        TEST_LOCAL_SUBJECT_WITH_SCHEMAS,
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
      ]);

      const fetchedLatestSchemas = await getLatestSchemasForTopic(testTopic);
      assert.strictEqual(fetchedLatestSchemas.length, 2);

      const expectedSubjectToVersion: Map<string, number> = new Map([
        [TEST_LOCAL_SUBJECT_WITH_SCHEMAS.name, 2],
        [TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.name, 2],
      ]);

      for (const schema of fetchedLatestSchemas) {
        assert.strictEqual(schema.version, expectedSubjectToVersion.get(schema.subject));
        expectedSubjectToVersion.delete(schema.subject);
      }

      // should have been all.
      assert.strictEqual(expectedSubjectToVersion.size, 0);
    });
  };
}

describe("commands/schemas.ts determineLatestSchema()", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return first Schema from a Subject carrying Schemas", async () => {
    const result = await determineLatestSchema("test", TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
    assert.strictEqual(result, TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![0]);
  });

  it("should fetch and return latest Schema when given Subject", async () => {
    const expectedSchema = TEST_CCLOUD_SCHEMA;
    const subject = TEST_CCLOUD_SUBJECT;

    stubbedLoader.getSchemasForSubject.resolves([expectedSchema]);

    const result = await determineLatestSchema("test", subject);

    assert.strictEqual(result, expectedSchema);
  });

  it("should throw error for invalid argument type", async () => {
    await assert.rejects(
      async () => await determineLatestSchema("test", {} as Subject),
      /called with invalid argument type/,
    );
  });
});

/**
 * Generic interface for types with a constructor function (i.e. a real class)
 *
 * Needed to constrain to types that have constructors as a requirement
 * for generic typing over types to be fed into sandbox.createStubInstance()
 */
interface Constructor<T> {
  new (...args: any[]): T;
}

/** Function generator that returns a matcher function that checks if the error message matches the given regex
 *  and that the exception is an instance of Error (and only Error, not a subclass)
 */
function raisedErrorMatcher(matcher: RegExp): (error: any) => boolean {
  return (error: any) => {
    return error instanceof Error && error.constructor === Error && matcher.test(error.message);
  };
}

/**
 * Error matcher function generator that checks if the error is an instance of CannotLoadSchemasError and that the error message
 * matches the given regex.
 */
function raisedCannotLoadSchemasErrorMatcher(matcher: RegExp): (error: any) => boolean {
  return (error: any) => {
    return error instanceof CannotLoadSchemasError && matcher.test(error.message);
  };
}
