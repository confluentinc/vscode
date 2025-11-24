import * as assert from "assert";
import * as sinon from "sinon";
import type { TextDocument } from "vscode";
import { Uri, workspace } from "vscode";
import { tryToOpenTextDocument } from "./workspace";

describe("quickpicks/utils/workspace.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("tryToOpenTextDocument", () => {
    let openTextDocumentStub: sinon.SinonStub;

    beforeEach(() => {
      openTextDocumentStub = sandbox.stub(workspace, "openTextDocument");
    });

    it("should return a TextDocument when opening a valid text file", async () => {
      const uri = Uri.file("/path/to/file.txt");
      const mockDocument: TextDocument = {
        uri,
        fileName: "/path/to/file.txt",
        languageId: "plaintext",
      } as TextDocument;
      openTextDocumentStub.resolves(mockDocument);

      const result = await tryToOpenTextDocument(uri);

      assert.strictEqual(result, mockDocument);
      sinon.assert.calledOnceWithExactly(openTextDocumentStub, uri);
    });

    it("should return undefined when opening a binary file throws an error", async () => {
      const uri = Uri.file("/path/to/binary.png");
      const error = new Error("Cannot read file as text");
      openTextDocumentStub.rejects(error);

      const result = await tryToOpenTextDocument(uri);

      assert.strictEqual(result, undefined);
      sinon.assert.calledOnceWithExactly(openTextDocumentStub, uri);
    });
  });
});
