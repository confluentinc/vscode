import * as assert from "assert";
import * as sinon from "sinon";
import {
  InputBoxValidationMessage,
  InputBoxValidationSeverity,
  languages,
  Uri,
  window,
} from "vscode";

import {
  getStubbedCCloudResourceLoader,
  getStubbedDirectResourceLoader,
  getStubbedLocalResourceLoader,
} from "../../../../tests/stubs/resourceLoaders";
import { getSidecarStub } from "../../../../tests/stubs/sidecar";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_DIRECT_SCHEMA,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_DIRECT_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REGISTRY,
  TEST_LOCAL_SUBJECT_WITH_SCHEMAS,
} from "../../../../tests/unit/testResources";
import { getTestExtensionContext } from "../../../../tests/unit/testUtils";
import {
  Configuration,
  RegisterRequest,
  ResponseError,
  SchemasV1Api,
  SubjectsV1Api,
} from "../../../clients/schemaRegistryRest";
import { ConnectionType } from "../../../clients/sidecar";
import { CCloudResourceLoader, ResourceLoader } from "../../../loaders";
import { Schema, SchemaType, Subject } from "../../../models/schema";
import {
  CCloudSchemaRegistry,
  DirectSchemaRegistry,
  LocalSchemaRegistry,
} from "../../../models/schemaRegistry";
import { KafkaTopic } from "../../../models/topic";
import * as quickPicksSchemas from "../../../quickpicks/schemas";
import { SidecarHandle } from "../../../sidecar";
import { getSchemasViewProvider } from "../../../viewProviders/schemas";
import {
  chooseSubject,
  determineDraftSchemaUri,
  determineLatestSchema,
  determineSchemaType,
  documentHasErrors,
  extractDetail,
  getHighestRegisteredVersion,
  getLatestSchemasForTopic,
  parseConflictMessage,
  registerSchema,
  schemaFromString,
  schemaRegistrationMessage,
  uploadSchema,
  validateNewSubject,
} from "./upload";

describe("commands/utils/schemaManagement/upload.ts", function () {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("determineLatestSchema()", () => {
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    beforeEach(() => {
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
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

  describe("determineDraftSchemaUri()", function () {
    it("should generate a draft URI with untitled scheme and encoded schema data", async function () {
      const schema = TEST_CCLOUD_SCHEMA;

      // Use a simple implementation that doesn't require complex mocking
      const result = await determineDraftSchemaUri(schema);

      assert.strictEqual(result.scheme, "untitled");
      assert.ok(result.query);

      // Decode and verify the schema data is in the query
      const decodedData = JSON.parse(decodeURIComponent(result.query));
      assert.strictEqual(decodedData.id, schema.id);
      assert.strictEqual(decodedData.subject, schema.subject);
    });
  });

  for (const connectionType of Object.values(ConnectionType)) {
    describe(`getLatestSchemasForTopic() for a ${connectionType} Schema Registry`, function () {
      let stubbedLoader: sinon.SinonStubbedInstance<ResourceLoader>;

      let testTopic: KafkaTopic;
      let testSchemaRegistry: CCloudSchemaRegistry | LocalSchemaRegistry | DirectSchemaRegistry;
      let testSubject: Subject;

      beforeEach(function () {
        switch (connectionType) {
          case ConnectionType.Ccloud:
            stubbedLoader = getStubbedCCloudResourceLoader(
              sandbox,
            ) as unknown as sinon.SinonStubbedInstance<ResourceLoader>;
            testTopic = KafkaTopic.create({
              ...TEST_CCLOUD_KAFKA_TOPIC,
              hasSchema: true,
              name: "test-topic",
            });
            testSchemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
            testSubject = TEST_CCLOUD_SUBJECT_WITH_SCHEMAS;
            break;
          case ConnectionType.Local:
            stubbedLoader = getStubbedLocalResourceLoader(
              sandbox,
            ) as unknown as sinon.SinonStubbedInstance<ResourceLoader>;
            testTopic = KafkaTopic.create({
              ...TEST_LOCAL_KAFKA_TOPIC,
              hasSchema: true,
              name: "test-topic",
            });
            testSchemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
            testSubject = TEST_LOCAL_SUBJECT_WITH_SCHEMAS;
            break;
          case ConnectionType.Direct:
            stubbedLoader = getStubbedDirectResourceLoader(
              sandbox,
            ) as unknown as sinon.SinonStubbedInstance<ResourceLoader>;
            testTopic = KafkaTopic.create({
              ...TEST_DIRECT_KAFKA_TOPIC,
              hasSchema: true,
              name: "test-topic",
            });
            testSchemaRegistry = TEST_DIRECT_SCHEMA_REGISTRY;
            testSubject = TEST_DIRECT_SUBJECT_WITH_SCHEMAS;
            break;
          default:
            throw new Error(`Unsupported connection type: ${connectionType}`);
        }
      });

      it("throws an error for topics without schemas", async function () {
        await assert.rejects(
          async () => {
            await getLatestSchemasForTopic(KafkaTopic.create({ ...testTopic, hasSchema: false }));
          },
          (error) =>
            error instanceof Error &&
            error.message.includes(
              `Asked to get schemas for topic "${testTopic.name}" believed to not have schema`,
            ),
        );
      });

      it("throws an error for topics without subject groups", async function () {
        stubbedLoader.getTopicSubjectGroups.resolves([]);
        await assert.rejects(
          async () => {
            await getLatestSchemasForTopic(testTopic);
          },
          (error) => {
            return (
              error instanceof Error &&
              error.message.includes(`Topic "${testTopic.name}" has no related schemas in registry`)
            );
          },
        );
      });

      it("should return the highest versioned schemas for topic with key and value topics", async function () {
        stubbedLoader.getSchemaRegistryForEnvironmentId.resolves(testSchemaRegistry);
        const oldestTestSchema: Schema = testSubject.schemas![-1];
        const testSubjects = [
          testSubject,
          new Subject(
            testSubject.name,
            testSubject.connectionId,
            testSubject.environmentId,
            testSubject.schemaRegistryId,
            [
              Schema.create({
                ...oldestTestSchema,
                id: "new-3",
                version: 3,
                isHighestVersion: true,
              }),
              Schema.create({ ...oldestTestSchema, id: "new-2", version: 2 }),
            ],
          ),
        ];
        stubbedLoader.getTopicSubjectGroups.resolves(testSubjects);

        const fetchedLatestSchemas: Schema[] = await getLatestSchemasForTopic(testTopic);
        // one latest-version for each subject
        assert.strictEqual(fetchedLatestSchemas.length, 2);

        fetchedLatestSchemas.forEach((schema, index) => {
          assert.strictEqual(schema.version, testSubjects[index].schemas![0].version);
        });
      });
    });
  }

  for (const connectionType of Object.values(ConnectionType)) {
    describe(`uploadSchema() to a ${connectionType} Schema Registry`, function () {
      let stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle>;
      let stubbedSubjectsV1Api: sinon.SinonStubbedInstance<SubjectsV1Api>;
      let stubbedSchemasV1Api: sinon.SinonStubbedInstance<SchemasV1Api>;
      let stubbedLoader: sinon.SinonStubbedInstance<ResourceLoader>;
      let showInfoStub: sinon.SinonStub;
      let revealSchemaStub: sinon.SinonStub;

      let testSchemaRegistry: CCloudSchemaRegistry | LocalSchemaRegistry | DirectSchemaRegistry;
      let testSchema: Schema;

      beforeEach(function () {
        stubbedSidecar = getSidecarStub(sandbox);
        stubbedSubjectsV1Api = sandbox.createStubInstance(SubjectsV1Api);
        // this is just to handle passing existing headers from SidecarHandle.getSubjectsV1Api()
        // when we manually set Content-Type: application/json
        stubbedSubjectsV1Api["configuration"] = { headers: {} } as unknown as Configuration;
        stubbedSchemasV1Api = sandbox.createStubInstance(SchemasV1Api);
        stubbedSidecar.getSubjectsV1Api.returns(stubbedSubjectsV1Api);
        stubbedSidecar.getSchemasV1Api.returns(stubbedSchemasV1Api);

        switch (connectionType) {
          case ConnectionType.Ccloud:
            stubbedLoader = getStubbedCCloudResourceLoader(
              sandbox,
            ) as unknown as sinon.SinonStubbedInstance<ResourceLoader>;
            testSchemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
            testSchema = TEST_CCLOUD_SCHEMA;
            break;
          case ConnectionType.Local:
            stubbedLoader = getStubbedLocalResourceLoader(
              sandbox,
            ) as unknown as sinon.SinonStubbedInstance<ResourceLoader>;
            testSchemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
            testSchema = TEST_LOCAL_SCHEMA;
            break;
          case ConnectionType.Direct:
            stubbedLoader = getStubbedDirectResourceLoader(
              sandbox,
            ) as unknown as sinon.SinonStubbedInstance<ResourceLoader>;
            testSchemaRegistry = TEST_DIRECT_SCHEMA_REGISTRY;
            testSchema = TEST_DIRECT_SCHEMA;
            break;
          default:
            throw new Error(`Unsupported connection type: ${connectionType}`);
        }

        showInfoStub = sandbox.stub(window, "showInformationMessage").resolves();
        revealSchemaStub = sandbox.stub(getSchemasViewProvider(), "revealSchema").resolves();
      });

      it("should upload a schema and show an info notification", async function () {
        // no existing versions, so we should create a new subject with schema version 1
        stubbedSubjectsV1Api.listVersions.resolves([]);
        // post-register, we should get the new schema version
        stubbedSubjectsV1Api.register.resolves({ id: parseInt(testSchema.id, 10) });
        stubbedSchemasV1Api.getVersions.resolves([{ subject: testSchema.subject, version: 1 }]);
        stubbedLoader.getSchemasForSubject.resolves([testSchema]);

        await uploadSchema(testSchemaRegistry, testSchema.subject, testSchema.type, "{}");

        // getHighestRegisteredVersion() tests will cover this more
        sinon.assert.calledOnce(stubbedSubjectsV1Api.listVersions);
        // registerSchema() tests will cover this more
        sinon.assert.calledOnce(stubbedSubjectsV1Api.register);
        // getNewlyRegisteredVersion() tests will cover this more
        sinon.assert.calledOnce(stubbedSchemasV1Api.getVersions);
        // updateRegistryCacheAndFindNewSchema() tests will cover this more
        sinon.assert.calledOnce(stubbedLoader.getSchemasForSubject);

        sinon.assert.calledOnce(showInfoStub);
        sinon.assert.notCalled(revealSchemaStub);
      });

      it("should upload a schema and show an info notification with existing subject (at least one schema version)", async function () {
        // existing subject with one version, so we should create a new schema version 2
        stubbedSubjectsV1Api.listVersions.resolves([1]);
        // post-register, we should get the new schema version
        stubbedSubjectsV1Api.register.resolves({ id: 2 });
        stubbedSchemasV1Api.getVersions.resolves([{ subject: testSchema.subject, version: 2 }]);
        const expectedNewSchema = Schema.create({
          ...testSchema,
          id: "2",
          version: 2,
          isHighestVersion: true,
        });
        stubbedLoader.getSchemasForSubject.resolves([testSchema, expectedNewSchema]);

        await uploadSchema(testSchemaRegistry, testSchema.subject, testSchema.type, "{}");

        // getHighestRegisteredVersion() tests will cover this more
        sinon.assert.calledOnce(stubbedSubjectsV1Api.listVersions);
        // registerSchema() tests will cover this more
        sinon.assert.calledOnce(stubbedSubjectsV1Api.register);
        // getNewlyRegisteredVersion() tests will cover this more
        sinon.assert.calledOnce(stubbedSchemasV1Api.getVersions);
        // updateRegistryCacheAndFindNewSchema() tests will cover this more
        sinon.assert.calledOnce(stubbedLoader.getSchemasForSubject);

        sinon.assert.calledOnce(showInfoStub);
        sinon.assert.notCalled(revealSchemaStub);
      });

      it("should focus the newly-uploaded schema when the user clicks 'View in Schema Registry'", async function () {
        // no existing versions, so we should create a new subject with schema version 1
        stubbedSubjectsV1Api.listVersions.resolves([]);
        // post-register, we should get the new schema version
        stubbedSubjectsV1Api.register.resolves({ id: parseInt(testSchema.id, 10) });
        stubbedSchemasV1Api.getVersions.resolves([{ subject: testSchema.subject, version: 1 }]);
        stubbedLoader.getSchemasForSubject.resolves([testSchema]);
        // simulate the user clicking "View in Schema Registry"
        showInfoStub.resolves("View in Schema Registry");

        await uploadSchema(testSchemaRegistry, testSchema.subject, testSchema.type, "{}");

        sinon.assert.calledOnce(showInfoStub);
        sinon.assert.calledOnce(revealSchemaStub);
      });
    });
  }

  describe("documentHasErrors()", function () {
    let getDiagnosticsStub: sinon.SinonStub;

    beforeEach(function () {
      getDiagnosticsStub = sandbox.stub(languages, "getDiagnostics");
    });

    it("should return true when document has error diagnostics", async function () {
      const uri = Uri.file("/path/to/schema.avsc");
      const errorDiagnostic = {
        severity: 0, // DiagnosticSeverity.Error
        message: "Syntax error",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      };
      getDiagnosticsStub.withArgs(uri).returns([errorDiagnostic]);

      const result = await documentHasErrors(uri);

      assert.strictEqual(result, true);
    });

    it("should return false when document has no error diagnostics", async function () {
      const uri = Uri.file("/path/to/schema.avsc");
      const warningDiagnostic = {
        severity: 1, // DiagnosticSeverity.Warning
        message: "Warning message",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      };
      getDiagnosticsStub.withArgs(uri).returns([warningDiagnostic]);

      const result = await documentHasErrors(uri);

      assert.strictEqual(result, false);
    });

    it("should return false when document has no diagnostics", async function () {
      const uri = Uri.file("/path/to/schema.avsc");
      getDiagnosticsStub.withArgs(uri).returns([]);

      const result = await documentHasErrors(uri);

      assert.strictEqual(result, false);
    });
  });

  describe("chooseSubject()", () => {
    let schemaSubjectQuickPickStub: sinon.SinonStub;
    let showInputBoxStub: sinon.SinonStub;

    // doesn't matter which SR; we just need one for chooseSubject() to pass to schemaSubjectQuickPick()
    const registry = TEST_LOCAL_SCHEMA_REGISTRY;

    beforeEach(() => {
      schemaSubjectQuickPickStub = sandbox.stub(quickPicksSchemas, "schemaSubjectQuickPick");
      showInputBoxStub = sandbox.stub(window, "showInputBox");
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

  describe("validateNewSubject()", () => {
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

  describe("parseConflictMessage()", () => {
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
      it(`should successfully extract detail from case ${instance}`, () => {
        const detail = parseConflictMessage(schemaType as SchemaType, message);
        assert.strictEqual(detail, expectedResult);
      });
    }
  });

  describe("extractDetail()", () => {
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

  describe("schemaRegistrationMessage()", function () {
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

  describe("determineSchemaType()", function () {
    let schemaTypeQuickPickStub: sinon.SinonStub;

    beforeEach(function () {
      schemaTypeQuickPickStub = sandbox
        .stub(quickPicksSchemas, "schemaTypeQuickPick")
        .resolves(undefined);
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

  describe("getHighestRegisteredVersion()", function () {
    let mockSchemaSubjectsApi: any;

    beforeEach(function () {
      mockSchemaSubjectsApi = {
        listVersions: sandbox.stub(),
      };
    });

    it("should return the highest version number when subject has versions", async function () {
      const versions = [1, 2, 3, 5, 4];
      mockSchemaSubjectsApi.listVersions.resolves(versions);

      const result = await getHighestRegisteredVersion(mockSchemaSubjectsApi, "test-subject");

      assert.strictEqual(result, 5);
      sinon.assert.calledOnceWithExactly(mockSchemaSubjectsApi.listVersions, {
        subject: "test-subject",
      });
    });

    it("should return undefined when subject has no versions", async function () {
      mockSchemaSubjectsApi.listVersions.resolves({ data: [] });

      const result = await getHighestRegisteredVersion(mockSchemaSubjectsApi, "test-subject");

      assert.strictEqual(result, undefined);
    });

    it("should return undefined when subject doesn't exist (404 error)", async function () {
      const error = new Error("Subject not found");
      (error as any).status = 404;
      mockSchemaSubjectsApi.listVersions.rejects(error);

      const result = await getHighestRegisteredVersion(
        mockSchemaSubjectsApi,
        "nonexistent-subject",
      );

      assert.strictEqual(result, undefined);
    });

    it("should re-throw non-404 errors", async function () {
      const error = new ResponseError(new Response("Server error", { status: 500 }));
      (error as any).status = 500;
      mockSchemaSubjectsApi.listVersions.rejects(error);

      await assert.rejects(
        async () => await getHighestRegisteredVersion(mockSchemaSubjectsApi, "test-subject"),
        (error) => error instanceof ResponseError && error.response.status === 500,
      );
    });
  });

  describe("registerSchema()", function () {
    let stubbedSubjectsV1Api: sinon.SinonStubbedInstance<SubjectsV1Api>;
    let showErrorStub: sinon.SinonStub;

    const extraHeaders = { foo: "bar" };

    beforeEach(function () {
      stubbedSubjectsV1Api = sandbox.createStubInstance(SubjectsV1Api);
      // this is just to handle passing existing headers from SidecarHandle.getSubjectsV1Api()
      // when we manually set Content-Type: application/json
      stubbedSubjectsV1Api["configuration"] = {
        headers: { ...extraHeaders },
      } as unknown as Configuration;

      showErrorStub = sandbox.stub(window, "showErrorMessage").resolves();
    });

    it("should register a new schema and return the schema ID", async function () {
      stubbedSubjectsV1Api.register.resolves({ id: 1 });
      const subject = "test-subject";
      const schemaType = SchemaType.Avro;
      const schemaContents = "{}";
      const normalize = true;

      const expectedRegisterRequest: RegisterRequest = {
        subject: subject,
        RegisterSchemaRequest: {
          schemaType: schemaType,
          schema: schemaContents,
        },
        normalize,
      };
      const expectedInitOverride = {
        headers: { ...extraHeaders, "Content-Type": "application/json" },
      };

      const result = await registerSchema(
        stubbedSubjectsV1Api,
        subject,
        schemaType,
        schemaContents,
        normalize,
      );

      assert.strictEqual(result, 1);
      sinon.assert.calledOnceWithExactly(
        stubbedSubjectsV1Api.register,
        expectedRegisterRequest,
        expectedInitOverride,
      );
      sinon.assert.notCalled(showErrorStub);
    });

    it("should show an error notification for ResponseErrors", async function () {
      const errorMessage = "uh oh";
      const errorStatus = 400;
      const error = new ResponseError(
        new Response(`{"message": "${errorMessage}"}`, { status: errorStatus }),
      );
      stubbedSubjectsV1Api.register.rejects(error);

      await assert.rejects(
        async () => {
          await registerSchema(stubbedSubjectsV1Api, "test-subject", SchemaType.Avro, "{}", true);
        },
        (err) => err instanceof ResponseError && err.response.status === errorStatus,
      );

      sinon.assert.calledOnce(stubbedSubjectsV1Api.register);
      sinon.assert.calledOnceWithMatch(
        showErrorStub,
        `Error ${errorStatus} uploading schema: ${errorMessage}`,
      );
    });

    it("should show an error notification for non-ResponseErrors", async function () {
      const errorMessage = "unexpected error";
      const error = new Error(errorMessage);
      stubbedSubjectsV1Api.register.rejects(error);

      await assert.rejects(
        async () => {
          await registerSchema(stubbedSubjectsV1Api, "test-subject", SchemaType.Avro, "{}", true);
        },
        (err) => err instanceof Error && err.message === errorMessage,
      );

      sinon.assert.calledOnce(stubbedSubjectsV1Api.register);
      sinon.assert.calledOnceWithMatch(showErrorStub, `Error uploading schema: ${error}`);
    });

    const errorResponseCases: [number, string, RegExp][] = [
      [409, '{"message": "test"}', /Conflict with prior schema version/],
      [415, '{"message": "test"}', /Unsupported Media Type/],
      [422, '{"message": "test", "error_code": 42201}', /Invalid schema/],
      // uncommon 422 case where error_code isn't present, just pass it through
      [422, '{"message": "uh oh"}', /Error 422 uploading schema/],
    ];
    for (const [statusCode, errorBody, expectedMessage] of errorResponseCases) {
      it(`should show a specific error notification for common ResponseErrors (status=${statusCode}, expected=${expectedMessage})`, async function () {
        const error = new ResponseError(new Response(errorBody, { status: statusCode }));
        stubbedSubjectsV1Api.register.rejects(error);

        await assert.rejects(
          async () => {
            await registerSchema(stubbedSubjectsV1Api, "test-subject", SchemaType.Avro, "{}", true);
          },
          (err) => err instanceof ResponseError && err.response.status === statusCode,
        );

        sinon.assert.calledOnce(stubbedSubjectsV1Api.register);
        sinon.assert.calledOnceWithMatch(showErrorStub, expectedMessage);
      });
    }
  });

  describe("getNewlyRegisteredVersion()", function () {});

  describe("updateRegistryCacheAndFindNewSchema()", function () {});

  describe("schemaFromString()", () => {
    it("should return a schema object with the correct values", () => {
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
});
