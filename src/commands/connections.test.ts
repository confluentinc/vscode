import * as assert from "assert";
import * as sinon from "sinon";
import { Uri, window } from "vscode";
import { getStubbedSecretStorage, StubbedSecretStorage } from "../../tests/stubs/extensionStorage";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_DIRECT_ENVIRONMENT } from "../../tests/unit/testResources";
import { TEST_CCLOUD_AUTH_SESSION } from "../../tests/unit/testResources/ccloudAuth";
import { TEST_DIRECT_CONNECTION_FORM_SPEC } from "../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as authnUtils from "../authn/utils";
import { EXTENSION_VERSION } from "../constants";
import * as directConnect from "../directConnect";
import { DirectConnectionManager } from "../directConnectManager";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { KRB5_CONFIG_PATH, SSL_PEM_PATHS } from "../extensionSettings/constants";
import { ConnectionId } from "../models/resource";
import * as notifications from "../notifications";
import * as ccloudConnections from "../sidecar/connections/ccloud";
import { SecretStorageKeys } from "../storage/constants";
import { CustomConnectionSpec, ResourceManager } from "../storage/resourceManager";
import * as fsWrappers from "../utils/fsWrappers";
import { ResourceViewProvider } from "../viewProviders/resources";
import * as connections from "./connections";

describe("commands/connections.ts", function () {
  let sandbox: sinon.SinonSandbox;

  before(async function () {
    await getTestExtensionContext();
  });

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("ccloudSignInCommand()", function () {
    let getCCloudAuthSessionStub: sinon.SinonStub;

    beforeEach(function () {
      getCCloudAuthSessionStub = sandbox.stub(authnUtils, "getCCloudAuthSession");
      // sandbox.stub(notifications, "showInfoNotificationWithButtons");
    });

    it("should call getCCloudAuthSession(true) to sign in through the auth provider", async function () {
      getCCloudAuthSessionStub.resolves(TEST_CCLOUD_AUTH_SESSION);

      await connections.ccloudSignInCommand();

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

        await connections.ccloudSignInCommand();

        sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub, true);
      });
    }

    it("should re-throw unexpected errors", async function () {
      const unexpectedError = new Error("Something unexpected happened");
      getCCloudAuthSessionStub.rejects(unexpectedError);

      await assert.rejects(connections.ccloudSignInCommand(), unexpectedError);

      sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub, true);
    });
  });

  describe("ccloudSignOutCommand()", function () {
    let showInformationMessageStub: sinon.SinonStub;
    let getCCloudAuthSessionStub: sinon.SinonStub;
    let deleteCCloudConnectionStub: sinon.SinonStub;
    let ccloudAuthSessionInvalidatedFireStub: sinon.SinonStub;
    let stubbedSecretStorage: StubbedSecretStorage;

    beforeEach(function () {
      showInformationMessageStub = sandbox.stub(window, "showInformationMessage");
      // stub auth functions and emitters
      getCCloudAuthSessionStub = sandbox.stub(authnUtils, "getCCloudAuthSession");
      deleteCCloudConnectionStub = sandbox.stub(ccloudConnections, "deleteCCloudConnection");
      ccloudAuthSessionInvalidatedFireStub = sandbox.stub(ccloudAuthSessionInvalidated, "fire");
      stubbedSecretStorage = getStubbedSecretStorage(sandbox);
    });

    it("should return early when no CCloud auth session exists", async function () {
      getCCloudAuthSessionStub.resolves(undefined);

      await connections.ccloudSignOutCommand();

      sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub);
      sinon.assert.notCalled(showInformationMessageStub);
      sinon.assert.notCalled(deleteCCloudConnectionStub);
    });

    it("should show a confirmation modal with the correct message and account label", async function () {
      getCCloudAuthSessionStub.resolves(TEST_CCLOUD_AUTH_SESSION);
      showInformationMessageStub.resolves("Cancel");

      await connections.ccloudSignOutCommand();

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

      await connections.ccloudSignOutCommand();

      sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub);
      sinon.assert.calledOnce(showInformationMessageStub);
      sinon.assert.notCalled(deleteCCloudConnectionStub);
      sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
    });

    it("should sign-out successfully by deleting the CCloud connection, clearing CCloud connected state in storage, and firing ccloudAuthSessionInvalidated", async function () {
      getCCloudAuthSessionStub.resolves(TEST_CCLOUD_AUTH_SESSION);
      showInformationMessageStub.resolves("Sign Out");
      deleteCCloudConnectionStub.resolves();

      await connections.ccloudSignOutCommand();

      sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub);
      sinon.assert.calledOnce(showInformationMessageStub);
      sinon.assert.calledOnce(deleteCCloudConnectionStub);
      sinon.assert.calledOnceWithExactly(
        stubbedSecretStorage.delete,
        SecretStorageKeys.CCLOUD_STATE,
      );
      sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
    });
  });

  describe("addSSLPemPathCommand()", function () {
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let showOpenDialogStub: sinon.SinonStub;

    beforeEach(function () {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);

      showOpenDialogStub = sandbox.stub(window, "showOpenDialog").resolves([]);
    });

    it(`should show a file open dialog and update the "${SSL_PEM_PATHS.id}" setting if a valid .pem file is selected`, async function () {
      const uri = { fsPath: "path/to/file.pem" } as Uri;
      showOpenDialogStub.resolves([uri]);

      await connections.addSSLPemPathCommand();

      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.calledOnce(stubbedConfigs.update);
      sinon.assert.calledOnceWithExactly(
        stubbedConfigs.update,
        SSL_PEM_PATHS.id,
        [uri.fsPath],
        true,
      );
    });

    it(`should not update the "${SSL_PEM_PATHS.id}" setting if no file is selected`, async function () {
      showOpenDialogStub.resolves([]);

      await connections.addSSLPemPathCommand();

      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.notCalled(stubbedConfigs.update);
    });

    it(`should not update the "${SSL_PEM_PATHS.id}" setting if an invalid file type is selected`, async function () {
      // shouldn't be possible from the command since we set a file extension filter, but just in case
      const uri = { fsPath: "path/to/file.txt" } as Uri;
      showOpenDialogStub.resolves([uri]);

      await connections.addSSLPemPathCommand();

      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.notCalled(stubbedConfigs.update);
    });

    it(`should add paths to existing paths in the "${SSL_PEM_PATHS.id}" setting`, async function () {
      const uri = { fsPath: "path/to/file.pem" } as Uri;
      showOpenDialogStub.resolves([uri]);
      stubbedConfigs.get.withArgs(SSL_PEM_PATHS.id).returns(["existing/path.pem"]);

      await connections.addSSLPemPathCommand();

      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.calledOnce(stubbedConfigs.update);
      sinon.assert.calledOnceWithExactly(
        stubbedConfigs.update,
        SSL_PEM_PATHS.id,
        ["existing/path.pem", uri.fsPath],
        true,
      );
    });
  });

  describe("deleteDirectConnectionCommand()", function () {
    let deleteConnectionStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;

    beforeEach(function () {
      deleteConnectionStub = sandbox
        .stub(DirectConnectionManager.getInstance(), "deleteConnection")
        .resolves();
      showWarningMessageStub = sandbox.stub(window, "showWarningMessage").resolves();
    });

    it("should delete the connection if the user confirms the deletion warning modal", async function () {
      showWarningMessageStub.resolves("Yes, disconnect");

      await connections.deleteDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      sinon.assert.calledOnce(showWarningMessageStub);
      sinon.assert.calledOnceWithExactly(
        deleteConnectionStub,
        TEST_DIRECT_ENVIRONMENT.connectionId,
      );
    });

    it("should not delete the connection if the user cancels the deletion warning modal", async function () {
      showWarningMessageStub.resolves("Cancel");

      await connections.deleteDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      sinon.assert.calledOnce(showWarningMessageStub);
      sinon.assert.notCalled(deleteConnectionStub);
    });

    it("should return early if the passed argument is not a DirectEnvironment", async function () {
      const invalidItem = "not-a-direct-environment";

      await connections.deleteDirectConnectionCommand(invalidItem as any);

      sinon.assert.notCalled(showWarningMessageStub);
      sinon.assert.notCalled(deleteConnectionStub);
    });
  });

  describe("createNewDirectConnectionCommand()", function () {
    let showOpenDialogStub: sinon.SinonStub;
    let showQuickPickStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;
    let openDirectConnectionFormStub: sinon.SinonStub;
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;

    beforeEach(function () {
      showOpenDialogStub = sandbox.stub(window, "showOpenDialog").resolves([]);
      showQuickPickStub = sandbox.stub(window, "showQuickPick");
      readFileStub = sandbox.stub(fsWrappers, "readFile");
      openDirectConnectionFormStub = sandbox.stub(directConnect, "openDirectConnectionForm");
      showErrorNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showErrorNotificationWithButtons",
      );
    });

    it("should return early if the user cancels the create/import quickpick", async function () {
      showQuickPickStub.resolves(undefined);

      await connections.createNewDirectConnectionCommand();

      sinon.assert.calledOnce(showQuickPickStub);
      sinon.assert.notCalled(showOpenDialogStub);
      sinon.assert.notCalled(openDirectConnectionFormStub);
    });

    it("should open the direct connection form when the user selects 'Enter manually'", async function () {
      showQuickPickStub.resolves({ label: "Enter manually" });

      await connections.createNewDirectConnectionCommand();

      sinon.assert.calledOnce(showQuickPickStub);
      sinon.assert.notCalled(showOpenDialogStub);
      sinon.assert.calledOnceWithExactly(openDirectConnectionFormStub, null);
    });

    it("should handle file import when the user selects 'Import from file'", async function () {
      const fakeFileUri = { fsPath: "/path/to/connection.json" } as Uri;
      const fakeSavedConnection = {
        ...TEST_DIRECT_CONNECTION_FORM_SPEC,
        id: undefined,
        extVersion: EXTENSION_VERSION,
      };

      showQuickPickStub.resolves({ label: "Import from file" });
      showOpenDialogStub.resolves([fakeFileUri]);
      readFileStub.resolves(JSON.stringify(fakeSavedConnection));

      await connections.createNewDirectConnectionCommand();

      sinon.assert.calledOnce(showQuickPickStub);
      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.calledOnce(readFileStub);
      sinon.assert.calledOnce(openDirectConnectionFormStub);

      const expectedSpec = {
        ...fakeSavedConnection,
        id: "FILE_UPLOAD" as ConnectionId,
        extVersion: undefined, // don't pass the extension version from the file
      };
      sinon.assert.calledWithMatch(openDirectConnectionFormStub, expectedSpec);
    });

    it("should return early if user cancels the file open dialog during import", async function () {
      showQuickPickStub.resolves({ label: "Import from file" });
      showOpenDialogStub.resolves([]);

      await connections.createNewDirectConnectionCommand();

      sinon.assert.calledOnce(showQuickPickStub);
      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.notCalled(readFileStub);
      sinon.assert.notCalled(openDirectConnectionFormStub);
    });

    it("should handle file parsing errors during import", async function () {
      const fakeFileUri = { fsPath: "/path/to/invalid.json" } as Uri;
      const invalidContent = "{ invalid json content";

      showQuickPickStub.resolves({ label: "Import from file" });
      showOpenDialogStub.resolves([fakeFileUri]);
      readFileStub.resolves(new TextEncoder().encode(invalidContent));

      await connections.createNewDirectConnectionCommand();

      sinon.assert.calledOnce(showQuickPickStub);
      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.calledOnce(readFileStub);
      sinon.assert.calledOnceWithExactly(
        showErrorNotificationWithButtonsStub,
        "Error parsing spec file. See logs for details.",
      );
      sinon.assert.notCalled(openDirectConnectionFormStub);
    });
  });

  describe("editDirectConnectionCommand()", function () {
    let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

    let openDirectConnectionFormStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let resourceViewProviderRefreshStub: sinon.SinonStub;

    beforeEach(function () {
      stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
      sandbox.stub(ResourceManager, "getInstance").returns(stubbedResourceManager);

      openDirectConnectionFormStub = sandbox.stub(directConnect, "openDirectConnectionForm");
      showErrorMessageStub = sandbox.stub(window, "showErrorMessage");

      resourceViewProviderRefreshStub = sandbox.stub(ResourceViewProvider.getInstance(), "refresh");
    });

    it("should return early if the passed argument is not a DirectEnvironment or string", async function () {
      const invalidItem = 123;

      await connections.editDirectConnectionCommand(invalidItem as any);

      sinon.assert.notCalled(stubbedResourceManager.getDirectConnection);
      sinon.assert.notCalled(openDirectConnectionFormStub);
    });

    it("should edit the existing connection when passed a DirectEnvironment", async function () {
      stubbedResourceManager.getDirectConnection.resolves(TEST_DIRECT_CONNECTION_FORM_SPEC);

      await connections.editDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getDirectConnection,
        TEST_DIRECT_ENVIRONMENT.connectionId,
      );
      sinon.assert.calledOnceWithExactly(
        openDirectConnectionFormStub,
        TEST_DIRECT_CONNECTION_FORM_SPEC,
      );
    });

    it("should edit the existing connection when passed a (ConnectionId) string", async function () {
      const connectionId = TEST_DIRECT_CONNECTION_FORM_SPEC.id;
      stubbedResourceManager.getDirectConnection.resolves(TEST_DIRECT_CONNECTION_FORM_SPEC);

      await connections.editDirectConnectionCommand(connectionId);

      sinon.assert.calledOnceWithExactly(stubbedResourceManager.getDirectConnection, connectionId);
      sinon.assert.calledOnceWithExactly(
        openDirectConnectionFormStub,
        TEST_DIRECT_CONNECTION_FORM_SPEC,
      );
    });

    it("should show an error notification and refresh the Resources view if the connection spec isn't found", async function () {
      stubbedResourceManager.getDirectConnection.resolves(null);

      await connections.editDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getDirectConnection,
        TEST_DIRECT_ENVIRONMENT.connectionId,
      );
      sinon.assert.calledOnceWithExactly(showErrorMessageStub, "Connection not found.");
      sinon.assert.calledOnce(resourceViewProviderRefreshStub);
      sinon.assert.notCalled(openDirectConnectionFormStub);
    });
  });

  describe("exportDirectConnectionCommand()", function () {
    let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

    let showWarningMessageStub: sinon.SinonStub;
    let showOpenDialogStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let writeFileStub: sinon.SinonStub;
    let resourceViewProviderRefreshStub: sinon.SinonStub;
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;

    const fakeFolderUri = Uri.file("/export/folder");

    beforeEach(function () {
      stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
      sandbox.stub(ResourceManager, "getInstance").returns(stubbedResourceManager);

      showWarningMessageStub = sandbox.stub(window, "showWarningMessage");
      showOpenDialogStub = sandbox.stub(window, "showOpenDialog");
      showErrorMessageStub = sandbox.stub(window, "showErrorMessage");
      showInformationMessageStub = sandbox.stub(window, "showInformationMessage");
      showTextDocumentStub = sandbox.stub(window, "showTextDocument");
      writeFileStub = sandbox.stub(fsWrappers, "writeFile");
      resourceViewProviderRefreshStub = sandbox.stub(ResourceViewProvider.getInstance(), "refresh");
      showErrorNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showErrorNotificationWithButtons",
      );
    });

    it("should return early if the passed argument is not a DirectEnvironment", async function () {
      const invalidItem = "not-a-direct-environment";

      await connections.exportDirectConnectionCommand(invalidItem as any);

      sinon.assert.notCalled(stubbedResourceManager.getDirectConnection);
    });

    it("should show an error notification and refresh the Resources view if the connection spec not found", async function () {
      stubbedResourceManager.getDirectConnection.resolves(null);

      await connections.exportDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      sinon.assert.calledOnceWithExactly(
        stubbedResourceManager.getDirectConnection,
        TEST_DIRECT_ENVIRONMENT.connectionId,
      );
      sinon.assert.calledOnceWithExactly(showErrorMessageStub, "Connection not found.");
      sinon.assert.calledOnce(resourceViewProviderRefreshStub);
    });

    it("should return early if the user cancels the export warning modal", async function () {
      stubbedResourceManager.getDirectConnection.resolves(TEST_DIRECT_CONNECTION_FORM_SPEC);
      showWarningMessageStub.resolves({ title: "Cancel", isCloseAffordance: true });

      await connections.exportDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      sinon.assert.calledOnce(showWarningMessageStub);
      sinon.assert.notCalled(showOpenDialogStub);
    });

    it("should return early if user cancels folder open dialog", async function () {
      stubbedResourceManager.getDirectConnection.resolves(TEST_DIRECT_CONNECTION_FORM_SPEC);
      showWarningMessageStub.resolves({ title: "Export" });
      showOpenDialogStub.resolves([]);

      await connections.exportDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      sinon.assert.calledOnce(showWarningMessageStub);
      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.notCalled(writeFileStub);
    });

    it("should export a connection successfully using the name for the JSON filename", async function () {
      const item = TEST_DIRECT_ENVIRONMENT;
      const renamedSpec: CustomConnectionSpec = {
        ...TEST_DIRECT_CONNECTION_FORM_SPEC,
        name: "Custom Test Connection",
      };
      const expectedFileUri = Uri.joinPath(
        fakeFolderUri,
        `${renamedSpec.name!.replace(/\s+/g, "_")}.json`,
      );
      stubbedResourceManager.getDirectConnection.resolves(renamedSpec);
      showWarningMessageStub.resolves({ title: "Export" });
      showOpenDialogStub.resolves([fakeFolderUri]);
      writeFileStub.resolves();
      showInformationMessageStub.resolves(undefined);

      await connections.exportDirectConnectionCommand(item);

      sinon.assert.calledOnce(showWarningMessageStub);
      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.calledOnce(writeFileStub);
      const expectedShareable = {
        ...renamedSpec,
        id: undefined,
        extVersion: EXTENSION_VERSION,
      };
      const expectedContent = JSON.stringify(expectedShareable, null, 2);
      sinon.assert.calledWithMatch(
        writeFileStub,
        sinon.match((uri: Uri) => {
          console.info(`Expected: ${expectedFileUri.toString()}, Actual: ${uri.toString()}`);
          return uri.toString() === expectedFileUri.toString();
        }),
        new TextEncoder().encode(expectedContent),
      );
      sinon.assert.calledOnceWithExactly(
        showInformationMessageStub,
        `Connection file saved at ${expectedFileUri.path}`,
        "Open File",
      );
    });

    it("should export a connection successfully even if it doesn't have a name", async function () {
      const item = TEST_DIRECT_ENVIRONMENT;
      const mockSpec: CustomConnectionSpec = {
        ...TEST_DIRECT_CONNECTION_FORM_SPEC,
        name: undefined,
      };
      stubbedResourceManager.getDirectConnection.resolves(mockSpec);
      showWarningMessageStub.resolves({ title: "Export" });
      showOpenDialogStub.resolves([fakeFolderUri]);
      writeFileStub.resolves();
      showInformationMessageStub.resolves(undefined);

      await connections.exportDirectConnectionCommand(item);

      sinon.assert.calledOnce(writeFileStub);
      // "connection" is the default when no `name` is present
      const expectedFileUri = Uri.joinPath(fakeFolderUri, "connection.json");
      sinon.assert.calledWithMatch(
        writeFileStub,
        sinon.match((uri: Uri) => uri.toString() === expectedFileUri.toString()),
      );
    });

    it("should open the exported connection file when the user clicks the 'Open File' notification button", async function () {
      stubbedResourceManager.getDirectConnection.resolves(TEST_DIRECT_CONNECTION_FORM_SPEC);
      showWarningMessageStub.resolves({ title: "Export" });
      showOpenDialogStub.resolves([fakeFolderUri]);
      writeFileStub.resolves();
      showInformationMessageStub.resolves("Open File");

      await connections.exportDirectConnectionCommand(TEST_DIRECT_ENVIRONMENT);

      const expectedFileUri = Uri.joinPath(
        fakeFolderUri,
        // "New Connection" to "New_Connection" for file name
        `${TEST_DIRECT_CONNECTION_FORM_SPEC.name?.replace(/\s+/g, "_")}.json`,
      );
      sinon.assert.calledOnceWithMatch(
        showTextDocumentStub,
        sinon.match((uri: Uri) => uri.toString() === expectedFileUri.toString()),
      );
    });

    it("should handle file write errors", async function () {
      const item = TEST_DIRECT_ENVIRONMENT;
      const mockSpec = TEST_DIRECT_CONNECTION_FORM_SPEC;
      const writeError = new Error("Write failed");
      stubbedResourceManager.getDirectConnection.resolves(mockSpec);
      showWarningMessageStub.resolves({ title: "Export" });
      showOpenDialogStub.resolves([fakeFolderUri]);
      writeFileStub.rejects(writeError);

      await connections.exportDirectConnectionCommand(item);

      sinon.assert.calledOnce(writeFileStub);
      sinon.assert.calledOnceWithExactly(
        showErrorNotificationWithButtonsStub,
        "Unable to save connection spec file.",
      );
    });
  });

  describe("setKrb5ConfigPathCommand()", function () {
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let showOpenDialogStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;

    beforeEach(function () {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
      showOpenDialogStub = sandbox.stub(window, "showOpenDialog").resolves([]);
      showInformationMessageStub = sandbox.stub(window, "showInformationMessage");
      showErrorMessageStub = sandbox.stub(window, "showErrorMessage");
    });

    it("should return early if no file is selected", async function () {
      showOpenDialogStub.resolves([]);

      await connections.setKrb5ConfigPathCommand();

      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.notCalled(stubbedConfigs.update);
    });

    it(`should update the "${KRB5_CONFIG_PATH.id}" setting for valid .conf file`, async function () {
      const fakeFileUri = { fsPath: "/path/to/krb5.conf" } as Uri;
      showOpenDialogStub.resolves([fakeFileUri]);

      await connections.setKrb5ConfigPathCommand();

      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.calledOnce(stubbedConfigs.update);
      sinon.assert.calledOnceWithExactly(
        stubbedConfigs.update,
        KRB5_CONFIG_PATH.id,
        fakeFileUri.fsPath,
        true,
      );
      sinon.assert.calledOnceWithExactly(
        showInformationMessageStub,
        `Kerberos config path set to: ${fakeFileUri.fsPath}`,
      );
    });

    it("should show an error notification for an invalid file extension", async function () {
      const fakeFileUri = { fsPath: "/path/to/invalid.txt" } as Uri;
      showOpenDialogStub.resolves([fakeFileUri]);

      await connections.setKrb5ConfigPathCommand();

      sinon.assert.calledOnce(showOpenDialogStub);
      sinon.assert.notCalled(stubbedConfigs.update);
      sinon.assert.calledOnceWithExactly(
        showErrorMessageStub,
        "No file selected. Please select a krb5.conf file.",
      );
    });
  });

  describe("getSSLPemPaths()", function () {
    let stubbedConfigs: StubbedWorkspaceConfiguration;

    beforeEach(function () {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    });

    it(`should return paths if they exists in the "${SSL_PEM_PATHS.id}" setting`, function () {
      stubbedConfigs.get.withArgs(SSL_PEM_PATHS.id, []).returns(["path/to/file.pem"]);

      const result = connections.getSSLPemPaths();

      assert.deepStrictEqual(result, ["path/to/file.pem"]);
    });

    it(`should return an empty array if the value of the "${SSL_PEM_PATHS.id}" setting is empty`, function () {
      stubbedConfigs.get.withArgs(SSL_PEM_PATHS.id, []).returns([]);

      const result = connections.getSSLPemPaths();

      assert.deepStrictEqual(result, []);
    });

    it("should only return valid .pem paths and not other string values", function () {
      stubbedConfigs.get
        .withArgs(SSL_PEM_PATHS.id, [])
        .returns(["path/to/file.pem", "invalid/path", ""]);

      const result = connections.getSSLPemPaths();

      assert.deepStrictEqual(result, ["path/to/file.pem"]);
    });
  });
});
