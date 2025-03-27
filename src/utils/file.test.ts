import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { fileUriExists, getEditorOrFileContents, LoadedDocumentContent } from "./file";
import * as fsWrappers from "./fsWrappers";

describe("fileUriExists", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return true if file exists", async () => {
    const uri = vscode.Uri.file("file:///file.ts");
    const fakeStat: vscode.FileStat = {
      type: vscode.FileType.File,
      ctime: 123,
      mtime: 123,
      size: 100,
    };

    sandbox.stub(fsWrappers, "statFile").resolves(fakeStat);
    const result = await fileUriExists(uri);

    assert.strictEqual(result, true);
  });

  it("should return False if file does not exist", async () => {
    const uri = vscode.Uri.file("file:///nonexistentfile.ts");
    sandbox.stub(fsWrappers, "statFile").rejects(new Error("File not found"));

    const result = await fileUriExists(uri);

    assert.strictEqual(result, false);
  });
});

describe("getEditorOrFileContents", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should prefer editor contents if editor is open over what is on disk", async () => {
    const uri = vscode.Uri.file("file:///file.ts");
    const fakeEditorContents = "Fake editor contents";
    const fakeEditor = {
      document: {
        uri,
        getText: () => fakeEditorContents,
      },
    };
    sandbox.stub(vscode.window, "visibleTextEditors").get(() => [fakeEditor as any]);

    // Also stub out differing file contents on disk. getEditorOrFileContents() should
    // prefer the editor contents over this.
    const fakeFileContents = "Bad on-disk contents";
    sandbox.stub(fsWrappers, "readFile").resolves(fakeFileContents);

    const result: LoadedDocumentContent = await getEditorOrFileContents(uri);

    assert.strictEqual(result.content, fakeEditorContents);
    assert.strictEqual(result.openDocument, fakeEditor.document);
  });

  it("should return file contents if editor is not open", async () => {
    const uri = vscode.Uri.file("file:///file.ts");
    const fakeFileContents = "Fake file contents";

    // No open editors ...
    sandbox.stub(vscode.window, "visibleTextEditors").get(() => []);
    // ... but a file that exists ...
    sandbox.stub(fsWrappers, "readFile").resolves(fakeFileContents);

    const result = await getEditorOrFileContents(uri);
    assert.strictEqual(result.content, fakeFileContents);
    assert.strictEqual(result.openDocument, undefined);
  });

  it("should throw an error if neither open editor nor file exists", async () => {
    // A file that actually does exist on UNIXen, but we stub out to simulate a non-existent file.
    // (also proving that the stubbing actually works)
    const uri = vscode.Uri.file("file:///etc/hosts");

    sandbox.stub(vscode.window, "visibleTextEditors").get(() => []);
    sandbox.stub(fsWrappers, "readFile").rejects(new Error("File not found"));

    assert.rejects(async () => {
      await getEditorOrFileContents(uri);
    });
  });
});
