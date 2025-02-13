import { Disposable, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { registerCommandWithLogging } from ".";
import { getCCloudAuthSession } from "../authn/utils";
import { openDirectConnectionForm } from "../directConnect";
import { DirectConnectionManager } from "../directConnectManager";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { ConnectionId } from "../models/resource";
import { SSL_PEM_PATHS } from "../preferences/constants";
import { deleteCCloudConnection } from "../sidecar/connections/ccloud";
import { CustomConnectionSpec, getResourceManager } from "../storage/resourceManager";
import { ResourceViewProvider } from "../viewProviders/resources";
import { ConnectionSpecFromJSON } from "../clients/sidecar";
import { FormConnectionType } from "../webview/direct-connect-form";

const logger = new Logger("commands.connections");

/** Allow CCloud sign-in via the auth provider outside of the Accounts section of the VS Code UI. */
async function ccloudSignIn() {
  try {
    await getCCloudAuthSession(true);
  } catch (error) {
    if (error instanceof Error) {
      // we don't need to do anything if:
      // - the user clicks "Cancel" on the modal before the sign-in process
      // - the auth provider handles a callback failure (which shows its own error notification)
      if (
        error.message === "User did not consent to login." ||
        error.message.includes("Authentication failed, see browser for details")
      ) {
        return;
      }
      // any other errors will be caught by the error handler in src/commands/index.ts as part of the
      // registerCommandWithLogging wrapper
      throw error;
    }
  }
}

async function ccloudSignOut() {
  const authSession = await getCCloudAuthSession();
  if (!authSession) {
    return;
  }

  // the authentication API doesn't provide a way to sign out, so we'll mirror the confirmation
  // dialog from the Accounts section of the VS Code UI
  const yesButton = "Sign Out";
  const confirmation = await window.showInformationMessage(
    `The account '${authSession.account.label}' has been used by: 

Confluent

Sign out from this extension?`,
    {
      modal: true,
    },
    yesButton,
    // "Cancel" is added by default
  );
  if (confirmation !== yesButton) {
    return;
  }
  // sign out by clearing the stored auth session
  await deleteCCloudConnection();
  ccloudAuthSessionInvalidated.fire();
}

/** Show the Open File dialog to let the user pick a .pem file and store it in the extension configs. */
export async function addSSLPemPath() {
  const newPemUris: Uri[] | undefined = await window.showOpenDialog({
    openLabel: "Select",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "PEM Files": ["pem"],
    },
  });

  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  const paths: string[] = configs.get(SSL_PEM_PATHS, []);
  if (newPemUris && newPemUris.length > 0) {
    const newPemPath: string = newPemUris[0].fsPath;
    if (newPemPath.endsWith(".pem")) {
      paths.push(newPemPath);
      configs.update(SSL_PEM_PATHS, paths, true);
      // no notification here since the setting will update in real-time when an item is added
    } else {
      // shouldn't be possible to get here since we restrict the file types in the dialog, but we
      // should include this because we can't do any kind of validation in the config itself for
      // array types
      window.showErrorMessage("SSL/TLS PEM file path not added. Please select a .pem file.");
    }
  }
}

export async function createNewDirectConnection() {
  // ignore any arguments passed through this command function (e.g. if something was highlighted
  // in the Resources view) so we always open the "Create a new connection" form
  // Open a quickpick to choose either from file or manual entry
  const createMethod = await window.showQuickPick(
    [
      { label: "FILE", description: "Select a JSON file with connection details" },
      { label: "FORM", description: "Enter connection details manually" },
    ],
    {
      placeHolder: "How would you like to create a new connection?",
      ignoreFocusOut: true,
    },
  );
  if (createMethod?.label === "FILE") {
    console.log("Opening file dialog");
    const newSpecUris: Uri[] | undefined = await window.showOpenDialog({
      openLabel: "Select",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "JSON Files": ["json"],
      },
    });

    if (newSpecUris && newSpecUris.length > 0) {
      try {
        const newSpecPath: string = newSpecUris[0].fsPath;
        console.log(newSpecPath);
        // read the file and parse it as a JSON object
        const fileContent = await workspace.fs.readFile(Uri.file(newSpecPath));
        const jsonSpec: CustomConnectionSpec = JSON.parse(fileContent.toString());
        console.log("json", jsonSpec);
        // validate the JSON object against the ConnectionSpec schema
        const newSpec = {
          ...ConnectionSpecFromJSON(jsonSpec),
          id: "FILE_UPLOAD" as ConnectionId, // TODO change ConnectionId in form when saving, use this to differentiate?
          formConnectionType: "Apache Kafka" as FormConnectionType,
        };
        console.log("new spec to open with:", newSpec);
        // if valid, use it to open the Direct Connection form (will have the fields pre-filled)
        openDirectConnectionForm(newSpec);
        // if invalid, show an error message with the validation errors
      } catch (error) {
        console.log(error);
        window.showErrorMessage("Error parsing spec file");
        return;
      }
    }
  } else {
    console.log("else no file block");
    openDirectConnectionForm(null);
  }
}

export async function deleteDirectConnection(item: DirectEnvironment) {
  if (!(item instanceof DirectEnvironment)) {
    return;
  }

  const yesButton = "Yes, disconnect";
  const confirmation = await window.showWarningMessage(
    `Are you sure you want to disconnect "${item.name}"? `,
    {
      modal: true,
      detail:
        "You will need to re-enter the associated connection details to reconnect. This will not delete any associated resources.",
    },
    yesButton,
    // "Cancel" is added by default
  );
  if (confirmation !== yesButton) {
    return;
  }

  await DirectConnectionManager.getInstance().deleteConnection(item.connectionId);
}

// XXX: the UI for this was replaced by editDirectConnection. Keeping in case we want to expose it again in the future elsewhere.
export async function renameDirectConnection(item: DirectEnvironment) {
  if (!(item instanceof DirectEnvironment)) {
    return;
  }
  const newName = await window.showInputBox({
    placeHolder: "Enter a new name for this connection",
    value: item.name,
    ignoreFocusOut: true,
  });
  if (!newName) {
    return;
  }

  // look up the associated ConnectionSpec
  const spec: CustomConnectionSpec | null = await getResourceManager().getDirectConnection(
    item.connectionId,
  );
  if (!spec) {
    logger.error("Direct connection not found, can't rename");
    // possibly stale Resources view? this shouldn't happen
    window.showErrorMessage("Connection not found.");
    ResourceViewProvider.getInstance().refresh();
    return;
  }

  // update and send it to the manager to update the sidecar + secret storage
  const updatedSpec: CustomConnectionSpec = {
    ...spec,
    name: newName,
  };
  await DirectConnectionManager.getInstance().updateConnection(updatedSpec);
}

export async function editDirectConnection(item: ConnectionId | DirectEnvironment) {
  // if the user clicked on the "Edit" button in the Resources view, the item will be a DirectEnvironment
  // otherwise, this was triggered via the commands API and should have been passed a ConnectionId arg
  if (!(item instanceof DirectEnvironment || typeof item === "string")) {
    return;
  }

  const connectionId = item instanceof DirectEnvironment ? item.connectionId : item;
  // look up the associated ConnectionSpec
  const spec: CustomConnectionSpec | null =
    await getResourceManager().getDirectConnection(connectionId);
  if (!spec) {
    logger.error("Direct connection not found, can't edit");
    // possibly stale Resources view? this shouldn't happen
    window.showErrorMessage("Connection not found.");
    ResourceViewProvider.getInstance().refresh();
    return;
  }

  openDirectConnectionForm(spec);
}

export function registerConnectionCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.connections.ccloud.signIn", ccloudSignIn),
    registerCommandWithLogging("confluent.connections.ccloud.signOut", ccloudSignOut),
    registerCommandWithLogging("confluent.connections.addSSLPemPath", addSSLPemPath),
    registerCommandWithLogging("confluent.connections.direct", createNewDirectConnection),
    registerCommandWithLogging("confluent.connections.direct.delete", deleteDirectConnection),
    // registerCommandWithLogging("confluent.connections.direct.rename", renameDirectConnection),
    registerCommandWithLogging("confluent.connections.direct.edit", editDirectConnection),
  ];
}

/** Get the path(s) of the SSL/TLS PEM file(s) based on the user's configuration. */
export function getSSLPemPaths(): string[] {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();
  const paths: string[] = configs.get(SSL_PEM_PATHS, []);
  // filter out paths that are empty strings or don't end with .pem since the user can manually edit
  // the setting if they don't go through the `addSSLPEMPath` command
  return paths.filter((path) => path && path.endsWith(".pem"));
}
