import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { TEST_DIRECT_ENVIRONMENT } from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { DirectConnectionManager } from "../directConnectManager";
import { SSL_PEM_PATHS } from "../preferences/constants";
import * as connections from "./connections";

describe("commands/connections.ts", function () {
  let sandbox: sinon.SinonSandbox;
  let showOpenDialogStub: sinon.SinonStub;
  let showWarningMessageStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

  before(async () => {
    // needed for the DirectConnectionManager to be initialized
    await getTestExtensionContext();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // avoid opening a dialog or notification modal during tests
    showOpenDialogStub = sandbox.stub(vscode.window, "showOpenDialog");
    showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage");
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
      get: sandbox.stub().withArgs(SSL_PEM_PATHS).returns(["path/to/file.pem"]),
    };
    getConfigurationStub.returns(mockConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, ["path/to/file.pem"]);
  });

  it("getSSLPemPaths() should return an empty array if the path is an empty array", function () {
    const emptyStringConfig = {
      get: sandbox.stub().withArgs(SSL_PEM_PATHS).returns([]),
    };
    getConfigurationStub.returns(emptyStringConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, []);
  });

  it("getSSLPemPaths() should return an empty array if the path is not set", function () {
    const nullConfig = {
      get: sandbox.stub().withArgs(SSL_PEM_PATHS, []).returns([]),
    };
    getConfigurationStub.returns(nullConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, []);
  });

  it("getSSLPemPaths() should only return valid .pem paths and not other string values", function () {
    const mixedConfig = {
      get: sandbox.stub().withArgs(SSL_PEM_PATHS).returns(["path/to/file.pem", "invalid/path", ""]),
    };
    getConfigurationStub.returns(mixedConfig);

    const result = connections.getSSLPemPaths();

    assert.deepStrictEqual(result, ["path/to/file.pem"]);
  });

  it("deleteDirectConnection() should delete the connection if user confirms", async function () {
    const item = TEST_DIRECT_ENVIRONMENT;
    showWarningMessageStub.resolves("Yes, disconnect");
    const deleteConnectionStub = sandbox
      .stub(DirectConnectionManager.getInstance(), "deleteConnection")
      .resolves();

    await connections.deleteDirectConnection(item);

    assert.ok(showWarningMessageStub.calledOnce);
    assert.ok(deleteConnectionStub.calledOnceWith(item.connectionId));
  });

  it("deleteDirectConnection() should not delete the connection if user cancels", async function () {
    const item = TEST_DIRECT_ENVIRONMENT;
    showWarningMessageStub.resolves("Cancel");
    const deleteConnectionStub = sandbox.stub(
      DirectConnectionManager.getInstance(),
      "deleteConnection",
    );

    await connections.deleteDirectConnection(item);

    assert.ok(showWarningMessageStub.calledOnce);
    assert.ok(deleteConnectionStub.notCalled);
  });
});
