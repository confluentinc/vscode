import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { BaseASTNode, Position as LSPosition, TextDocument } from "vscode-json-languageservice";
import * as uris from "../quickpicks/uris";
import { convertToVSPosition, createRange, getRangeForDocument } from "./parsing";
import * as validateDocument from "./validateDocument";

describe("schemas/parsing.ts convertToVSPosition()", () => {
  it(" should convert a language service position to VS Code position", () => {
    const lsPosition: LSPosition = { line: 5, character: 10 };

    const vsPosition = convertToVSPosition(lsPosition);

    assert.strictEqual(vsPosition instanceof vscode.Position, true);
    assert.strictEqual(vsPosition.line, 5);
    assert.strictEqual(vsPosition.character, 10);
  });

  it("should handle zero values", () => {
    const lsPosition: LSPosition = { line: 0, character: 0 };

    const vsPosition = convertToVSPosition(lsPosition);

    assert.strictEqual(vsPosition.line, 0);
    assert.strictEqual(vsPosition.character, 0);
  });

  it("should handle large values", () => {
    const lsPosition: LSPosition = { line: 9999, character: 12345 };

    const vsPosition = convertToVSPosition(lsPosition);

    assert.strictEqual(vsPosition.line, 9999);
    assert.strictEqual(vsPosition.character, 12345);
  });
});

describe("schemas/parsing.ts createRange()", () => {
  let sandbox: sinon.SinonSandbox;
  let mockTextDocument: TextDocument;
  let positionAtStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub TextDocument's positionAt method to control its return value
    positionAtStub = sandbox.stub();
    mockTextDocument = {
      positionAt: positionAtStub,
    } as unknown as TextDocument;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should create a range from a node's offset and length", () => {
    // return fake positions
    positionAtStub.withArgs(100).returns({ line: 5, character: 10 });
    positionAtStub.withArgs(150).returns({ line: 7, character: 20 });

    const fakeNode = {
      offset: 100,
      length: 50,
    } as BaseASTNode;

    const range = createRange(mockTextDocument, fakeNode);

    assert.strictEqual(range instanceof vscode.Range, true);
    assert.strictEqual(range.start.line, 5);
    assert.strictEqual(range.start.character, 10);
    assert.strictEqual(range.end.line, 7);
    assert.strictEqual(range.end.character, 20);

    // verify the text document's positionAt was called with the correct offsets
    sinon.assert.calledWith(positionAtStub.firstCall, 100);
    sinon.assert.calledWith(positionAtStub.secondCall, 150);
  });

  it("should handle zero offset", () => {
    positionAtStub.withArgs(0).returns({ line: 0, character: 0 });
    positionAtStub.withArgs(25).returns({ line: 0, character: 25 });

    const fakeNode = {
      offset: 0,
      length: 25,
    } as BaseASTNode;

    const range = createRange(mockTextDocument, fakeNode);

    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.line, 0);
    assert.strictEqual(range.end.character, 25);
  });
});

describe("schemas/parsing.ts getRangeForDocument()", () => {
  let sandbox: sinon.SinonSandbox;
  let loadDocumentContentStub: sinon.SinonStub;
  let initializeJsonDocumentStub: sinon.SinonStub;

  const fakeFileUri = vscode.Uri.parse("file:///test.json");
  const fakeSchema = { type: "object" };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loadDocumentContentStub = sandbox.stub(uris, "loadDocumentContent");
    initializeJsonDocumentStub = sandbox.stub(validateDocument, "initializeJsonDocument");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return empty range for empty document", async () => {
    loadDocumentContentStub.resolves({ content: "{}" });
    initializeJsonDocumentStub.returns({
      textDocument: {} as TextDocument,
      jsonDocument: { root: null },
    });

    const range = await getRangeForDocument(fakeFileUri, fakeSchema);

    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.line, 0);
    assert.strictEqual(range.end.character, 0);
  });

  it("should find property in single object document", async () => {
    loadDocumentContentStub.resolves({ content: '{"test": "value"}' });

    const fakeTextDocument = {
      positionAt: (offset: number) => {
        if (offset === 1) return { line: 0, character: 1 };
        if (offset === 15) return { line: 0, character: 15 };
        return { line: 0, character: 0 };
      },
    } as unknown as TextDocument;
    initializeJsonDocumentStub.returns({
      textDocument: fakeTextDocument,
      jsonDocument: {
        root: {
          type: "object",
          properties: [
            {
              keyNode: { value: "test" },
              offset: 1,
              length: 14,
            },
          ],
        },
      },
    });

    const range = await getRangeForDocument(fakeFileUri, fakeSchema, 0, "test");

    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 1);
    assert.strictEqual(range.end.line, 0);
    assert.strictEqual(range.end.character, 15);
  });

  it("should find item in array document", async () => {
    loadDocumentContentStub.resolves({ content: '[{"key": "value1"}, {"key": "value2"}]' });

    const fakeTextDocument = {
      positionAt: (offset: number) => {
        if (offset === 1) return { line: 0, character: 1 };
        if (offset === 18) return { line: 0, character: 18 };
        if (offset === 20) return { line: 0, character: 20 };
        if (offset === 37) return { line: 0, character: 37 };
        return { line: 0, character: 0 };
      },
    } as unknown as TextDocument;
    initializeJsonDocumentStub.returns({
      textDocument: fakeTextDocument,
      jsonDocument: {
        root: {
          type: "array",
          items: [
            {
              offset: 1,
              length: 17,
              type: "object",
            },
            {
              offset: 20,
              length: 17,
              type: "object",
            },
          ],
        },
      },
    });

    // test finding the second item (index 1)
    const range = await getRangeForDocument(fakeFileUri, fakeSchema, 1);

    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 20);
    assert.strictEqual(range.end.line, 0);
    assert.strictEqual(range.end.character, 37);
  });

  it("should find property in array item", async () => {
    loadDocumentContentStub.resolves({ content: '[{"key": "value1"}, {"key": "value2"}]' });

    const fakeTextDocument = {
      positionAt: (offset: number) => {
        if (offset === 22) return { line: 0, character: 22 };
        if (offset === 35) return { line: 0, character: 35 };
        return { line: 0, character: 0 };
      },
    } as unknown as TextDocument;
    initializeJsonDocumentStub.returns({
      textDocument: fakeTextDocument,
      jsonDocument: {
        root: {
          type: "array",
          // property node within the object at index 1
          items: [
            {},
            {
              offset: 20,
              length: 17,
              type: "object",
              properties: [
                {
                  offset: 22,
                  length: 13,
                  keyNode: { value: "key" },
                },
              ],
            },
          ],
        },
      },
    });

    // find the "key" property in the second item (index 1)
    const range = await getRangeForDocument(fakeFileUri, fakeSchema, 1, "key");

    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 22);
    assert.strictEqual(range.end.line, 0);
    assert.strictEqual(range.end.character, 35);
  });
});
