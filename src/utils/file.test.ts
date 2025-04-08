import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import {
  fileUriExists,
  getEditorOrFileContents,
  LoadedDocumentContent,
  WriteableTmpDir,
} from "./file";
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
    const fakeDocumentContents = "Fake editor contents";
    const fakeDocument = {
      uri,
      getText: () => fakeDocumentContents,
    };
    sandbox.stub(vscode.workspace, "textDocuments").get(() => [fakeDocument as any]);

    // Also stub out differing file contents on disk. getEditorOrFileContents() should
    // prefer the editor contents over this.
    const fakeFileContents = "Bad on-disk contents";
    const readFileStub = sandbox.stub(fsWrappers, "readFile").resolves(fakeFileContents);

    const result: LoadedDocumentContent = await getEditorOrFileContents(uri);

    assert.strictEqual(result.content, fakeDocumentContents);
    assert.strictEqual(result.openDocument, fakeDocument);
    assert.ok(readFileStub.notCalled, "readFile should not be called if editor is open");
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

describe("WriteableTmpDir", () => {
  let sandbox: sinon.SinonSandbox;

  let tmpdirStub: sinon.SinonStub;
  let writeFileStub: sinon.SinonStub;
  let deleteFileStub: sinon.SinonStub;
  let instance: WriteableTmpDir;
  let originalInstance: WriteableTmpDir | undefined;
  let originalEnvTMPDIR: string | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    tmpdirStub = sandbox.stub(fsWrappers, "tmpdir");
    writeFileStub = sandbox.stub(fsWrappers, "writeFile");
    deleteFileStub = sandbox.stub(fsWrappers, "deleteFile");

    originalInstance = WriteableTmpDir["instance"];
    originalEnvTMPDIR = process.env["TMPDIR"];
    instance = WriteableTmpDir.getInstance();
    // Set instance to initial state.
    instance["_tmpdir"] = undefined;
  });

  afterEach(() => {
    sandbox.restore();
    process.env["TMPDIR"] = originalEnvTMPDIR;
    WriteableTmpDir["instance"] = originalInstance;
  });

  it("determine() should prefer tmpdir() if possible; get() then return it", async () => {
    tmpdirStub.returns("/tmp");
    await instance.determine();
    const result = instance.get();
    assert.strictEqual(result, "/tmp");
    sinon.assert.calledOnce(tmpdirStub);
    sinon.assert.calledOnce(writeFileStub);
    sinon.assert.calledOnce(deleteFileStub);
  });

  it("determine() should throw an error if no writeable temporary directory is found", async () => {
    writeFileStub.throws(new Error("writeFile() boom"));
    await assert.rejects(async () => {
      await instance.determine();
    }, /No writeable tmpdir found/);

    // Should have tried writing at least 4x, based on what env vars set.
    assert.ok(writeFileStub.callCount >= 4);
  });

  it("get() should raise if called before determine()", () => {
    assert.throws(() => {
      instance.get();
    }, /get\(\) called before determine\(\) was awaited/);
  });
});
