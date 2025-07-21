import * as assert from "assert";
import * as sinon from "sinon";
import { languages, TextEditor, window } from "vscode";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_DIRECT_SCHEMA,
  TEST_LOCAL_SCHEMA,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { SchemaString, SchemasV1Api } from "../clients/schemaRegistryRest";
import { ConnectionType } from "../clients/sidecar";
import { Schema, SchemaType } from "../models/schema";
import { SidecarHandle } from "../sidecar";
import {
  openReadOnlySchemaDocument,
  prettifySchemaDefinition,
  SchemaDocumentProvider,
  setLanguageForSchemaEditor,
} from "./schema";

describe("documentProviders/schema.ts", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("SchemaDocumentProvider provideTextDocumentContent() and fetchSchemaBody()", function () {
    let stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle>;
    let stubbedSchemasV1Api: sinon.SinonStubbedInstance<SchemasV1Api>;
    let testSchema: Schema;

    beforeEach(function () {
      stubbedSidecar = getSidecarStub(sandbox);
      stubbedSchemasV1Api = sandbox.createStubInstance(SchemasV1Api);
      stubbedSidecar.getSchemasV1Api.returns(stubbedSchemasV1Api);
    });

    for (const connectionType of Object.values(ConnectionType)) {
      switch (connectionType) {
        case ConnectionType.Ccloud:
          testSchema = TEST_CCLOUD_SCHEMA;
          break;
        case ConnectionType.Local:
          testSchema = TEST_LOCAL_SCHEMA;
          break;
        case ConnectionType.Direct:
          testSchema = TEST_DIRECT_SCHEMA;
          break;
        default:
          throw new Error(`Unknown connection type: ${connectionType}`);
      }

      it(`should fetch and return a valid schema definition from a ${connectionType} schema URI`, async () => {
        const schemaResp: SchemaString = { schema: '{"foo": "bar"}' };
        stubbedSchemasV1Api.getSchema.resolves(schemaResp);

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        const schemaDefinition = await provider.provideTextDocumentContent(uri);

        assert.strictEqual(schemaDefinition, JSON.stringify(JSON.parse('{"foo": "bar"}'), null, 2));
        sinon.assert.calledOnceWithExactly(stubbedSchemasV1Api.getSchema, {
          id: parseInt(testSchema.id, 10),
        });
      });

      it(`should throw an error from an empty from a ${connectionType} schema URI`, async () => {
        const schemaResp: SchemaString = { schema: "" };
        stubbedSchemasV1Api.getSchema.resolves(schemaResp);

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        await assert.rejects(
          provider.provideTextDocumentContent(uri),
          new Error("Failed to load schema definition; it may be empty or invalid."),
        );
      });
    }
  });

  describe("prettifySchemaDefinition()", function () {
    for (const schemaType of [SchemaType.Avro, SchemaType.Json, undefined]) {
      it(`should prettify a schema definition for schemaType=${schemaType}`, function () {
        const schema = '{"foo": "bar"}';
        const schemaResp: SchemaString = { schema, schemaType };

        const prettified = prettifySchemaDefinition(schemaResp);

        assert.strictEqual(prettified, JSON.stringify(JSON.parse(schema), null, 2));
      });
    }

    it(`should not prettify a ${SchemaType.Protobuf} schema definition`, function () {
      const schema = "syntax = 'proto3'; message Foo { string bar = 1; }";
      const schemaResp: SchemaString = { schema, schemaType: SchemaType.Protobuf };

      const prettified = prettifySchemaDefinition(schemaResp);

      assert.strictEqual(prettified, schema);
    });

    it("should return undefined for an empty schema definition", function () {
      const schemaResp: SchemaString = { schema: "", schemaType: SchemaType.Avro };

      const prettified = prettifySchemaDefinition(schemaResp);

      assert.strictEqual(prettified, undefined);
    });

    it("should return the raw content for an invalid JSON schema definition", function () {
      const schema = "not json";
      const schemaResp: SchemaString = { schema, schemaType: SchemaType.Avro };

      const prettified = prettifySchemaDefinition(schemaResp);

      assert.strictEqual(prettified, schema);
    });
  });

  describe("openReadOnlySchemaDocument()", function () {
    let stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle>;
    let stubbedSchemasV1Api: sinon.SinonStubbedInstance<SchemasV1Api>;
    let testSchema: Schema;

    before(async function () {
      // activate to make sure we register the SchemaDocumentProvider URI scheme
      await getTestExtensionContext();
    });

    beforeEach(function () {
      stubbedSidecar = getSidecarStub(sandbox);
      stubbedSchemasV1Api = sandbox.createStubInstance(SchemasV1Api);
      stubbedSidecar.getSchemasV1Api.returns(stubbedSchemasV1Api);
      // connection type doesn't matter for this test
      testSchema = TEST_CCLOUD_SCHEMA;
    });

    it("should load or create a schema viewer for a valid schema", async function () {
      const schemaResp: SchemaString = { schema: '{"foo": "bar"}' };
      stubbedSchemasV1Api.getSchema.resolves(schemaResp);

      const editor = await openReadOnlySchemaDocument(testSchema);

      assert.ok(editor);
      assert.strictEqual(
        editor.document.getText(),
        JSON.stringify(JSON.parse('{"foo": "bar"}'), null, 2),
      );
    });
  });

  describe("setLanguageForSchemaEditor()", function () {
    let getLanguagesStub: sinon.SinonStub;
    let setTextDocumentLanguageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;

    const testEditor: TextEditor = {
      document: { uri: { scheme: "file" } },
      edit: async () => true,
    } as unknown as TextEditor;

    beforeEach(function () {
      getLanguagesStub = sandbox.stub(languages, "getLanguages").resolves([]);
      setTextDocumentLanguageStub = sandbox.stub(languages, "setTextDocumentLanguage").resolves();
      showWarningMessageStub = sandbox.stub(window, "showWarningMessage");
    });

    it("should set the editor language to 'json' for a JSON schema type", async function () {
      getLanguagesStub.resolves(["json"]);

      await setLanguageForSchemaEditor(testEditor, SchemaType.Json);

      sinon.assert.calledOnceWithExactly(setTextDocumentLanguageStub, testEditor.document, "json");
      sinon.assert.notCalled(showWarningMessageStub);
    });

    const languageSupport: [string, SchemaType][] = [
      ["avroavsc", SchemaType.Avro],
      ["proto", SchemaType.Protobuf],
      ["json", SchemaType.Json],
    ];
    languageSupport.forEach(([language, type]) => {
      it(`should set the editor language to '${language}' for a ${type} schema type when ${language} support is available`, async function () {
        getLanguagesStub.resolves([language]);

        await setLanguageForSchemaEditor(testEditor, type);

        sinon.assert.calledOnceWithExactly(
          setTextDocumentLanguageStub,
          testEditor.document,
          language,
        );
        sinon.assert.notCalled(showWarningMessageStub);
      });
    });

    it("should set the editor language to 'json' for an Avro schema type when Avro support is not available", async function () {
      getLanguagesStub.resolves(["json"]);

      await setLanguageForSchemaEditor(testEditor, SchemaType.Avro);

      sinon.assert.calledOnceWithExactly(setTextDocumentLanguageStub, testEditor.document, "json");
      sinon.assert.notCalled(showWarningMessageStub);
    });

    it("should not set the editor language when no matching language is found", async function () {
      getLanguagesStub.resolves(["avroavsc", "json"]);

      await setLanguageForSchemaEditor(testEditor, SchemaType.Protobuf);

      sinon.assert.notCalled(setTextDocumentLanguageStub);
      sinon.assert.calledOnceWithMatch(
        showWarningMessageStub,
        /Could not find a matching editor language/,
      );
    });
  });
});
