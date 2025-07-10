import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedSecretStorage, StubbedSecretStorage } from "../../tests/stubs/extensionStorage";
import { TEST_DIRECT_ENVIRONMENT } from "../../tests/unit/testResources";
import { TEST_CCLOUD_AUTH_SESSION } from "../../tests/unit/testResources/ccloudAuth";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as authnUtils from "../authn/utils";
import { DirectConnectionManager } from "../directConnectManager";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { SSL_PEM_PATHS } from "../extensionSettings/constants";
import * as ccloudConnections from "../sidecar/connections/ccloud";
import { SecretStorageKeys } from "../storage/constants";
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

describe("commands/connections.ts ccloudSignIn()", function () {
  let sandbox: sinon.SinonSandbox;
  let getCCloudAuthSessionStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    getCCloudAuthSessionStub = sandbox.stub(authnUtils, "getCCloudAuthSession");
    // no need to stub the info notification here since that's done through the auth provider
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should call getCCloudAuthSession(true) to sign in through the auth provider", async function () {
    getCCloudAuthSessionStub.resolves(TEST_CCLOUD_AUTH_SESSION);

    await connections.ccloudSignIn();

    sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub, true);
  });

  for (const errorMsg of [
    "User did not consent to login.",
    "User cancelled the authentication flow.",
    "Confluent Cloud authentication failed. See browser for details.",
    "User reset their password.",
  ]) {
    it(`should not re-throw specific errors -> "${errorMsg}"`, async function () {
      const cancelError = new Error(errorMsg);
      getCCloudAuthSessionStub.rejects(cancelError);

      await connections.ccloudSignIn();

      sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub, true);
    });
  }

  it("should re-throw unexpected errors", async function () {
    const unexpectedError = new Error("Something unexpected happened");
    getCCloudAuthSessionStub.rejects(unexpectedError);

    await assert.rejects(connections.ccloudSignIn(), unexpectedError);

    sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub, true);
  });
});

describe("commands/connections.ts ccloudSignOut()", function () {
  let sandbox: sinon.SinonSandbox;

  let showInformationMessageStub: sinon.SinonStub;
  let getCCloudAuthSessionStub: sinon.SinonStub;
  let deleteCCloudConnectionStub: sinon.SinonStub;
  let ccloudAuthSessionInvalidatedFireStub: sinon.SinonStub;
  let stubbedSecretStorage: StubbedSecretStorage;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
    // stub auth functions and emitters
    getCCloudAuthSessionStub = sandbox.stub(authnUtils, "getCCloudAuthSession");
    deleteCCloudConnectionStub = sandbox.stub(ccloudConnections, "deleteCCloudConnection");
    ccloudAuthSessionInvalidatedFireStub = sandbox.stub(ccloudAuthSessionInvalidated, "fire");
    stubbedSecretStorage = getStubbedSecretStorage(sandbox);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return early when no CCloud auth session exists", async function () {
    getCCloudAuthSessionStub.resolves(undefined);

    await connections.ccloudSignOut();

    sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub);
    sinon.assert.notCalled(showInformationMessageStub);
    sinon.assert.notCalled(deleteCCloudConnectionStub);
  });

  it("should show a confirmation modal with the correct message and account label", async function () {
    getCCloudAuthSessionStub.resolves(TEST_CCLOUD_AUTH_SESSION);
    showInformationMessageStub.resolves("Cancel");

    await connections.ccloudSignOut();

    sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub);
    sinon.assert.calledOnceWithExactly(
      showInformationMessageStub,
      `The account '${TEST_CCLOUD_AUTH_SESSION.account.label}' has been used by: 

Confluent

Sign out from this extension?`,
      {
        modal: true,
      },
      "Sign Out",
    );
    sinon.assert.notCalled(deleteCCloudConnectionStub);
  });

  it("should return early when the user cancels/dismisses the sign-out confirmation modal", async function () {
    getCCloudAuthSessionStub.resolves(TEST_CCLOUD_AUTH_SESSION);
    // no difference in the return value between dismissing or clicking "Cancel" in the modal
    showInformationMessageStub.resolves(undefined);

    await connections.ccloudSignOut();

    sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub);
    sinon.assert.calledOnce(showInformationMessageStub);
    sinon.assert.notCalled(deleteCCloudConnectionStub);
    sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
  });

  it("should sign-out successfully by deleting the CCloud connection, clearing CCloud connected state in storage, and firing ccloudAuthSessionInvalidated", async function () {
    getCCloudAuthSessionStub.resolves(TEST_CCLOUD_AUTH_SESSION);
    showInformationMessageStub.resolves("Sign Out");
    deleteCCloudConnectionStub.resolves();

    await connections.ccloudSignOut();

    sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub);
    sinon.assert.calledOnce(showInformationMessageStub);
    sinon.assert.calledOnce(deleteCCloudConnectionStub);
    sinon.assert.calledOnceWithExactly(stubbedSecretStorage.delete, SecretStorageKeys.CCLOUD_STATE);
    sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
  });
});
