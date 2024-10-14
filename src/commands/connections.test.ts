import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { SSL_PEM_PATHS } from "../preferences/constants";
import * as connections from "./connections";

describe("commands/connections.ts", function () {
  let sandbox: sinon.SinonSandbox;
  let showOpenDialogStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // stub the showOpenDialog method to avoid opening a dialog during tests
    showOpenDialogStub = sandbox.stub(vscode.window, "showOpenDialog");
    // stub the WorkspaceConfiguration
    getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
  });

  afterEach(function () {
    sandbox.restore();
  });

  // TODO: add tests for createConnectionCommand

  it("addSSLPemPath() should show open dialog and update config if valid .pem file is selected", async function () {
    const uri = { fsPath: "path/to/file.pem" } as vscode.Uri;
    showOpenDialogStub.resolves([uri]);
    getConfigurationStub.returns({
      get: sandbox.stub().returns([]),
      update: sandbox.stub(),
    });

    await connections.addSSLPemPath();

    assert.ok(showOpenDialogStub.calledOnce);
    assert.ok(getConfigurationStub().update.calledOnce);
    assert.ok(getConfigurationStub().update.calledOnceWith(SSL_PEM_PATHS, [uri.fsPath], true));
  });

  it("addSSLPemPath() should not update config if no file is selected", async function () {
    showOpenDialogStub.resolves([]);
    getConfigurationStub.returns({
      get: sandbox.stub().returns([]),
      update: sandbox.stub(),
    });

    await connections.addSSLPemPath();

    assert.ok(showOpenDialogStub.calledOnce);
    assert.ok(getConfigurationStub().update.notCalled);
  });

  it("addSSLPemPath() should not update config if invalid file is selected", async function () {
    const uri = { fsPath: "path/to/file.txt" } as vscode.Uri;
    showOpenDialogStub.resolves([uri]);
    getConfigurationStub.returns({
      get: sandbox.stub().returns([]),
      update: sandbox.stub(),
    });

    await connections.addSSLPemPath();

    assert.ok(showOpenDialogStub.calledOnce);
    assert.ok(getConfigurationStub().update.notCalled);
  });

  it("addSSLPemPath() should add paths to existing paths in the config", async function () {
    const uri = { fsPath: "path/to/file.pem" } as vscode.Uri;
    showOpenDialogStub.resolves([uri]);
    getConfigurationStub.returns({
      get: sandbox.stub().returns(["existing/path.pem"]),
      update: sandbox.stub(),
    });

    await connections.addSSLPemPath();

    assert.ok(showOpenDialogStub.calledOnce);
    assert.ok(getConfigurationStub().update.calledOnce);
    assert.ok(
      getConfigurationStub().update.calledOnceWith(
        SSL_PEM_PATHS,
        ["existing/path.pem", uri.fsPath],
        true,
      ),
    );
  });

  it("getSSLPemPaths() should return paths if they exists in the config", function () {
    const mockConfig = {
      get: sandbox.stub().callsFake((key: string) => {
        if (key === SSL_PEM_PATHS) return ["path/to/file.pem"];
      }),
    };
    getConfigurationStub.returns(mockConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, ["path/to/file.pem"]);
  });

  it("getSSLPemPaths() should return an empty array if the path is an empty array", function () {
    const emptyStringConfig = {
      get: sandbox.stub().callsFake((key: string) => {
        if (key === SSL_PEM_PATHS) return [];
      }),
    };
    getConfigurationStub.returns(emptyStringConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, []);
  });

  it("getSSLPemPaths() should return an empty array if the path is not set", function () {
    const nullConfig = {
      get: sandbox.stub().callsFake((key: string, defaultValue?: unknown) => {
        if (key === SSL_PEM_PATHS) return defaultValue;
      }),
    };
    getConfigurationStub.returns(nullConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, []);
  });

  it("getSSLPemPaths() should only return valid .pem paths and not other string values", function () {
    const mixedConfig = {
      get: sandbox.stub().callsFake((key: string) => {
        if (key === SSL_PEM_PATHS) return ["path/to/file.pem", "invalid/path", ""];
      }),
    };
    getConfigurationStub.returns(mixedConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, ["path/to/file.pem"]);
  });
});
