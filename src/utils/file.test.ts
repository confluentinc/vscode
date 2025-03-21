import * as vscode from "vscode";
import * as assert from "assert";
import sinon from "sinon";
import * as fileUtils from "./file";

describe("fileUriExists", () => {
  let sandbox: sinon.SinonSandbox;

  // Setup before each test
  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  // Cleanup after each test
  afterEach(() => {
    sandbox.restore();
  });

  it("should stub statFile correctly", async () => {
    const uri = vscode.Uri.file("file:///file.ts");
    const fakeStat: vscode.FileStat = {
      type: vscode.FileType.File,
      ctime: 123,
      mtime: 123,
      size: 100,
    };

    const statStub = sandbox.stub(fileUtils, "statFile").resolves(fakeStat);
    const result = await fileUtils.statFile(uri);

    assert.deepStrictEqual(result, fakeStat, "Expected statFile to return fakeStat");
    assert.strictEqual(statStub.calledOnceWithExactly(uri), true);
  });

  it("should stub statFile with error", async () => {
    const uri = vscode.Uri.file("file:///nonexistant/file.ts");

    const statStub = sandbox.stub(fileUtils, "statFile").rejects(new Error("File not found"));

    try {
      await fileUtils.statFile(uri);
      assert.fail("Expected statFile to throw an error");
    } catch (error: any) {
      assert.strictEqual(
        error.message,
        "File not found",
        "Expected error message to be 'File not found'",
      );
    }

    assert.strictEqual(statStub.calledOnceWithExactly(uri), true);
  });

  it("should return true when file exists", async () => {
    const uri = vscode.Uri.file("file:///file.ts");

    const statStub = sandbox.stub(fileUtils, "fileUriExists").resolves(true);

    const result = await fileUtils.fileUriExists(uri);

    assert.strictEqual(result, true, "Expected fileUriExists to return true");
    assert.strictEqual(
      statStub.calledOnceWithExactly(uri),
      true,
      "Expected statFile to be called once with the correct URI",
    );
  });

  it("should return false when file does not exist", async () => {
    const uri = vscode.Uri.file("/path/to/nonexistent/file.txt");
    const statStub = sandbox.stub(fileUtils, "fileUriExists").resolves(false);
    const result = await fileUtils.fileUriExists(uri);

    assert.strictEqual(result, false);
    assert.strictEqual(statStub.calledOnceWithExactly(uri), true);
  });

  it("should handle unexpected errors gracefully", async () => {
    const uri = vscode.Uri.file("/path/to/file.txt");
    const statStub = sandbox.stub(fileUtils, "statFile").rejects(new Error("Unexpected error"));

    try {
      await fileUtils.statFile(uri);
      assert.fail("Expected statFile to throw an error");
    } catch (error: any) {
      assert.strictEqual(
        error.message,
        "Unexpected error",
        "Expected error message to be 'File not found'",
      );
    }

    assert.strictEqual(statStub.calledOnceWithExactly(uri), true);
  });
});
