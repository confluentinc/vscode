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
    const fakeDocument: TextDocument = { uri: testUri } as unknown as TextDocument;

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

    it("should provide 'Generate Medusa Dataset' codelens when feature flag is true", async () => {
      stubbedConfigs.stubGet(ENABLE_MEDUSA_CONTAINER, true);
      const codeLenses: CodeLens[] = await provider.provideCodeLenses(fakeDocument);

      assert.strictEqual(codeLenses.length, 1);

      const generateLens = codeLenses[0];
      assert.ok(generateLens.command);
      assert.strictEqual(generateLens.command?.command, MEDUSA_COMMANDS.GENERATE_DATASET);
      assert.strictEqual(generateLens.command?.title, "Generate Medusa Dataset");
      assert.strictEqual(
        generateLens.command?.tooltip,
        "Generate a Medusa dataset from this Avro schema file",
      );
      assert.deepStrictEqual(generateLens.command?.arguments, [fakeDocument.uri]);
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
