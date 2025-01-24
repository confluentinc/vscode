import * as assert from "assert";
import * as sinon from "sinon";
import { Diagnostic, DiagnosticSeverity, languages, Uri } from "vscode";
import * as uris from "../quickpicks/uris";
import { PRODUCE_MESSAGE_SCHEMA } from "./produceMessageSchema";
import { validateDocument } from "./validateDocument";

const BASIC_MESSAGE = {
  key: "foo",
  value: "bar",
};

describe("schemas/produceMessageSchema validation", function () {
  let sandbox: sinon.SinonSandbox;
  let loadDocumentContentStub: sinon.SinonStub;

  const fakeUri = Uri.file("test.json");

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    loadDocumentContentStub = sandbox.stub(uris, "loadDocumentContent");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should not return any diagnostics for a valid message", async function () {
    loadDocumentContentStub.resolves({ content: JSON.stringify(BASIC_MESSAGE) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = languages.getDiagnostics(fakeUri)!;
    assert.strictEqual(diagnostics.length, 0);
  });

  for (const missingField of ["key", "value"]) {
    it(`should return an error diagnostic for a message with no \`${missingField}\``, async function () {
      const invalidMessage = {
        [missingField === "key" ? "value" : "key"]: "foo",
      };
      loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

      await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

      const diagnostics: readonly Diagnostic[] = languages.getDiagnostics(fakeUri)!;
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message, `Missing property "${missingField}".`);
      assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
    });
  }

  it("should return an error diagnostic for a header with no `key`/`name`", async function () {
    const invalidMessage = {
      ...BASIC_MESSAGE,
      headers: [{ value: "qux" }],
    };
    loadDocumentContentStub.resolves({ content: JSON.stringify(invalidMessage) });

    await validateDocument(fakeUri, PRODUCE_MESSAGE_SCHEMA);

    const diagnostics: readonly Diagnostic[] = languages.getDiagnostics(fakeUri)!;
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, `Missing property "key".`);
    assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Error);
  });
});
