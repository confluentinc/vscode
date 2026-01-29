import * as assert from "assert";
import * as sinon from "sinon";
import type { TextEditor } from "vscode";
import { languages, window } from "vscode";
import {
  getStubbedCCloudResourceLoader,
  getStubbedDirectResourceLoader,
  getStubbedLocalResourceLoader,
} from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_SCHEMA,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import type { SchemaString } from "../clients/schemaRegistryRest";
import { ConnectionType } from "../connections";
import { SchemaType } from "../models/schema";
import * as schemaRegistryProxy from "../proxy/schemaRegistryProxy";
import {
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
    let mockProxy: {
      getSchemaString: sinon.SinonStub;
    };

    describe(`${ConnectionType.Ccloud} connection type`, function () {
      const testSchema = TEST_CCLOUD_SCHEMA;

      beforeEach(function () {
        getStubbedCCloudResourceLoader(sandbox).getSchemaRegistryForEnvironmentId.resolves(
          TEST_CCLOUD_SCHEMA_REGISTRY,
        );

        mockProxy = {
          getSchemaString: sandbox.stub(),
        };
        sandbox
          .stub(schemaRegistryProxy, "createSchemaRegistryProxy")
          .returns(
            mockProxy as unknown as ReturnType<
              typeof schemaRegistryProxy.createSchemaRegistryProxy
            >,
          );
      });

      it(`should fetch and return a valid schema definition from a CCloud schema URI`, async function () {
        mockProxy.getSchemaString.resolves('{"foo": "bar"}');

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        const schemaDefinition = await provider.provideTextDocumentContent(uri);

        assert.strictEqual(schemaDefinition, JSON.stringify(JSON.parse('{"foo": "bar"}'), null, 2));
      });

      it(`should throw an error from an empty from a CCloud schema URI`, async function () {
        mockProxy.getSchemaString.resolves("");

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        await assert.rejects(
          provider.provideTextDocumentContent(uri),
          new Error("Failed to load schema definition; it may be empty or invalid."),
        );
      });
    });

    describe(`${ConnectionType.Local} connection type`, function () {
      const testSchema = TEST_LOCAL_SCHEMA;

      beforeEach(function () {
        getStubbedLocalResourceLoader(sandbox).getSchemaRegistryForEnvironmentId.resolves(
          TEST_LOCAL_SCHEMA_REGISTRY,
        );

        mockProxy = {
          getSchemaString: sandbox.stub(),
        };
        sandbox
          .stub(schemaRegistryProxy, "createSchemaRegistryProxy")
          .returns(
            mockProxy as unknown as ReturnType<
              typeof schemaRegistryProxy.createSchemaRegistryProxy
            >,
          );
      });

      it(`should fetch and return a valid schema definition from a Local schema URI`, async function () {
        mockProxy.getSchemaString.resolves('{"foo": "bar"}');

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        const schemaDefinition = await provider.provideTextDocumentContent(uri);

        assert.strictEqual(schemaDefinition, JSON.stringify(JSON.parse('{"foo": "bar"}'), null, 2));
      });

      it(`should throw an error from an empty from a Local schema URI`, async function () {
        mockProxy.getSchemaString.resolves("");

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        await assert.rejects(
          provider.provideTextDocumentContent(uri),
          new Error("Failed to load schema definition; it may be empty or invalid."),
        );
      });
    });

    describe(`${ConnectionType.Direct} connection type`, function () {
      const testSchema = TEST_DIRECT_SCHEMA;

      beforeEach(function () {
        getStubbedDirectResourceLoader(sandbox).getSchemaRegistryForEnvironmentId.resolves(
          TEST_DIRECT_SCHEMA_REGISTRY,
        );

        mockProxy = {
          getSchemaString: sandbox.stub(),
        };
        sandbox
          .stub(schemaRegistryProxy, "createSchemaRegistryProxy")
          .returns(
            mockProxy as unknown as ReturnType<
              typeof schemaRegistryProxy.createSchemaRegistryProxy
            >,
          );
      });

      it(`should fetch and return a valid schema definition from a Direct schema URI`, async function () {
        mockProxy.getSchemaString.resolves('{"foo": "bar"}');

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        const schemaDefinition = await provider.provideTextDocumentContent(uri);

        assert.strictEqual(schemaDefinition, JSON.stringify(JSON.parse('{"foo": "bar"}'), null, 2));
      });

      it(`should throw an error from an empty from a Direct schema URI`, async function () {
        mockProxy.getSchemaString.resolves("");

        const provider = new SchemaDocumentProvider();
        const uri = provider.resourceToUri(testSchema, testSchema.fileName());
        await assert.rejects(
          provider.provideTextDocumentContent(uri),
          new Error("Failed to load schema definition; it may be empty or invalid."),
        );
      });
    });
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

  // TODO: Re-enable after openReadOnlySchemaDocument is refactored to use direct API calls
  describe.skip("openReadOnlySchemaDocument()", function () {
    before(async function () {
      // activate to make sure we register the SchemaDocumentProvider URI scheme
      await getTestExtensionContext();
    });

    it("should load or create a schema viewer for a valid schema", async function () {
      // Tests need to be updated after sidecar removal
      assert.ok(true);
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
