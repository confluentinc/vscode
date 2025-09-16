import * as assert from "assert";
import * as sinon from "sinon";
import { CodeLens, Position, Range, TextDocument, Uri } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { MEDUSA_COMMANDS } from "../commands/medusaCodeLens";
import { ENABLE_MEDUSA_CONTAINER } from "../extensionSettings/constants";
import { AvroCodelensProvider } from "./avroProvider";

const testUri = Uri.parse("file:///test/schema.avsc");

describe("codelens/avroProvider.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("AvroCodelensProvider", () => {
    let provider: AvroCodelensProvider;

    // NOTE: setting up fake TextDocuments is tricky since we can't create them directly, so we're
    // only populating the fields needed for the test and associated codebase logic, then using the
    // `as unknown as TextDocument` pattern to appease TypeScript
    const createFakeDocument = (
      content: string,
      languageId: string = "json",
      uri: Uri = testUri,
    ): TextDocument => {
      return {
        uri,
        languageId,
        getText: () => content,
      } as unknown as TextDocument;
    };

    const validAvroSchema = JSON.stringify({
      type: "record",
      name: "User",
      fields: [
        { name: "id", type: "int" },
        { name: "name", type: "string" },
      ],
    });

    const invalidJson = "{ invalid json";
    const nonAvroJson = JSON.stringify({ name: "test", version: "1.0.0" });
    const fakeDocument: TextDocument = createFakeDocument(validAvroSchema);

    beforeEach(() => {
      provider = AvroCodelensProvider.getInstance();
    });

    afterEach(() => {
      provider.dispose();
      AvroCodelensProvider["instance"] = null;
    });

    it("should create only one instance of AvroCodelensProvider", () => {
      const provider2 = AvroCodelensProvider.getInstance();

      try {
        assert.strictEqual(provider, provider2);
      } finally {
        provider2.dispose();
      }
    });

    it("should create codelenses at the top of the document", async () => {
      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      const expectedRange = new Range(new Position(0, 0), new Position(0, 0));
      for (const lens of codeLenses) {
        assert.deepStrictEqual(lens.range, expectedRange);
      }
    });

    it("should provide 'Generate Medusa Dataset' codelens when feature flag is true and document is valid Avro", async () => {
      stubbedConfigs.stubGet(ENABLE_MEDUSA_CONTAINER, true);
      const validAvroDoc = createFakeDocument(validAvroSchema);
      const codeLenses: CodeLens[] = await provider.provideCodeLenses(validAvroDoc);

      assert.strictEqual(codeLenses.length, 1);

      const generateLens = codeLenses[0];
      assert.ok(generateLens.command);
      assert.strictEqual(generateLens.command?.command, MEDUSA_COMMANDS.GENERATE_DATASET);
      assert.strictEqual(generateLens.command?.title, "Generate Medusa Dataset");
      assert.strictEqual(
        generateLens.command?.tooltip,
        "Generate a Medusa dataset from this Avro schema file",
      );
      assert.deepStrictEqual(generateLens.command?.arguments, [validAvroDoc.uri]);
    });

    it("should not provide 'Generate Medusa Dataset' codelens when feature flag is false", async () => {
      stubbedConfigs.stubGet(ENABLE_MEDUSA_CONTAINER, false);
      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      assert.strictEqual(codeLenses.length, 0);
    });

    it("should create codelens with correct range at document start", async () => {
      stubbedConfigs.stubGet(ENABLE_MEDUSA_CONTAINER, true);

      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      assert.strictEqual(codeLenses.length, 1);

      const generateLens = codeLenses[0];
      const expectedRange = new Range(new Position(0, 0), new Position(0, 0));
      assert.deepStrictEqual(generateLens.range, expectedRange);
    });

    describe("isAvroDocument validation", () => {
      beforeEach(() => {
        stubbedConfigs.stubGet(ENABLE_MEDUSA_CONTAINER, true);
      });

      it("should always provide codelens for .avsc files regardless of content", async () => {
        const avscUri = Uri.parse("file:///test/schema.avsc");
        const invalidDoc = createFakeDocument(invalidJson, "json", avscUri);
        const codeLenses = await provider.provideCodeLenses(invalidDoc);
        assert.strictEqual(codeLenses.length, 1);
      });

      it("should always provide codelens for avroavsc language regardless of content", async () => {
        const invalidDoc = createFakeDocument(invalidJson, "avroavsc");
        const codeLenses = await provider.provideCodeLenses(invalidDoc);
        assert.strictEqual(codeLenses.length, 1);
      });

      it("should provide codelens for JSON language with valid Avro schemas", async () => {
        const allAvroTypes = [
          "null",
          "boolean",
          "int",
          "long",
          "float",
          "double",
          "bytes",
          "string",
          "record",
          "enum",
          "array",
          "map",
          "union",
          "fixed",
        ];

        for (const type of allAvroTypes) {
          const schema = JSON.stringify({ type });
          const doc = createFakeDocument(schema, "json");
          const codeLenses = await provider.provideCodeLenses(doc);
          assert.strictEqual(codeLenses.length, 1, `Failed for type: ${type}`);
        }
      });

      it("should not provide codelens for JSON language with non-Avro content", async () => {
        const nonAvscUri = Uri.parse("file:///test/data.json"); // Use non-.avsc URI
        const testCases = [
          { name: "non-Avro JSON", content: nonAvroJson },
          { name: "invalid JSON", content: invalidJson },
          {
            name: "JSON without type field",
            content: JSON.stringify({ name: "SomeObject", properties: { id: "number" } }),
          },
          {
            name: "JSON with non-string type",
            content: JSON.stringify({ type: 123, name: "InvalidType" }),
          },
          {
            name: "JSON with invalid Avro type",
            content: JSON.stringify({ type: "invalid_type", name: "Test" }),
          },
        ];

        for (const testCase of testCases) {
          const doc = createFakeDocument(testCase.content, "json", nonAvscUri);
          const codeLenses = await provider.provideCodeLenses(doc);
          assert.strictEqual(codeLenses.length, 0, `Failed for: ${testCase.name}`);
        }
      });

      it("should provide codelens for other language types", async () => {
        const nonAvscUri = Uri.parse("file:///test/data.txt"); // Use non-.avsc URI
        const doc = createFakeDocument(validAvroSchema, "plaintext", nonAvscUri);
        const codeLenses = await provider.provideCodeLenses(doc);
        assert.strictEqual(codeLenses.length, 1);
      });

      it("should not crash with undefined URI and validate JSON content", async () => {
        const docWithUndefinedUri = {
          uri: undefined,
          languageId: "json",
          getText: () => validAvroSchema,
        } as unknown as TextDocument;

        const codeLenses = await provider.provideCodeLenses(docWithUndefinedUri);
        assert.strictEqual(codeLenses.length, 1); // Should validate JSON content and show CodeLens
      });

      it("should not crash with URI that has undefined fsPath and validate JSON content", async () => {
        const docWithNoFsPath = {
          uri: { fsPath: undefined },
          languageId: "json",
          getText: () => validAvroSchema,
        } as unknown as TextDocument;

        const codeLenses = await provider.provideCodeLenses(docWithNoFsPath);
        assert.strictEqual(codeLenses.length, 1); // Should validate JSON content and show CodeLens
      });

      it("should handle empty fsPath and validate JSON content", async () => {
        const docWithEmptyFsPath = {
          uri: { fsPath: "" },
          languageId: "json",
          getText: () => validAvroSchema,
        } as unknown as TextDocument;

        const codeLenses = await provider.provideCodeLenses(docWithEmptyFsPath);
        assert.strictEqual(codeLenses.length, 1); // Should work since it's valid Avro JSON
      });
    });

    describe("singleton behavior", () => {
      it("should return the same instance on multiple calls", () => {
        const instance1 = AvroCodelensProvider.getInstance();
        const instance2 = AvroCodelensProvider.getInstance();
        const instance3 = AvroCodelensProvider.getInstance();

        assert.strictEqual(instance1, instance2);
        assert.strictEqual(instance2, instance3);
        assert.strictEqual(instance1, instance3);

        // Clean up
        instance1.dispose();
        AvroCodelensProvider["instance"] = null;
      });

      it("should create new instance after dispose and reset", () => {
        const instance1 = AvroCodelensProvider.getInstance();
        instance1.dispose();
        AvroCodelensProvider["instance"] = null;

        const instance2 = AvroCodelensProvider.getInstance();

        assert.notStrictEqual(instance1, instance2);

        // Clean up
        instance2.dispose();
        AvroCodelensProvider["instance"] = null;
      });
    });
  });
});
