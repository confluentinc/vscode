import { Disposable, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { registerCommandWithLogging } from ".";
import { getCCloudAuthSession } from "../authn/utils";
import { EXTENSION_VERSION } from "../constants";
import { openDirectConnectionForm } from "../directConnect";
import { DirectConnectionManager } from "../directConnectManager";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { ConnectionId } from "../models/resource";
import { showErrorNotificationWithButtons } from "../notifications";
import { SSL_PEM_PATHS } from "../preferences/constants";
import { deleteCCloudConnection } from "../sidecar/connections/ccloud";
import {
  CustomConnectionSpec,
  CustomConnectionSpecFromJSON,
  getResourceManager,
} from "../storage/resourceManager";
import { ResourceViewProvider } from "../viewProviders/resources";

const logger = new Logger("commands.connections");

/** Allow CCloud sign-in via the auth provider outside of the Accounts section of the VS Code UI. */
async function ccloudSignIn() {
  try {
    await getCCloudAuthSession(true);
  } catch (error) {
    if (error instanceof Error) {
      // we don't need to do anything if:
      // - the user clicks "Cancel" on the modal before the sign-in process, or on the progress
      //  notification after the sign-in process has started
      // - the auth provider handles a callback failure (which shows its own error notification)
      if (
        error.message === "User did not consent to login." ||
        error.message === "User cancelled the authentication flow." ||
        error.message === "Confluent Cloud authentication failed. See browser for details." ||
        error.message === "User reset their password."
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
  const importLabel = "Import from file";
  const createMethod = await window.showQuickPick(
    [
      { label: "Enter manually", description: "Enter connection details by filling in a form" },
      { label: importLabel, description: "Select a JSON file with connection details" },
    ],
    {
      placeHolder: "How would you like to create a new connection?",
      ignoreFocusOut: true,
    },
  );
  if (!createMethod) {
    // User exited the quick pick without making a choice
    return;
  }
  if (createMethod?.label === importLabel) {
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
        // read the file and parse it as a JSON object
        const fileContent = await workspace.fs.readFile(Uri.file(newSpecPath));
        const jsonSpec = JSON.parse(fileContent.toString());

        // validate the JSON object against the ConnectionSpec schema
        const newSpec = {
          ...CustomConnectionSpecFromJSON(jsonSpec),
          id: "FILE_UPLOAD" as ConnectionId,
        };
        // use it to open the Direct Connection form (form will populate the fields with spec values)
        openDirectConnectionForm(newSpec);
      } catch (error) {
        showErrorNotificationWithButtons("Error parsing spec file. See logs for details.");
        logger.error(`Error parsing spec file: ${error}`);
        return;
      }
    }
  } else {
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

export async function exportDirectConnection(item: DirectEnvironment) {
  // look up the associated ConnectionSpec
  const spec: CustomConnectionSpec | null = await getResourceManager().getDirectConnection(
    item.connectionId,
  );

  // This shouldn't happen since we open from the item view, but for insurance...
  if (!spec) {
    logger.error("Direct connection not found, can't share");
    window.showErrorMessage("Connection not found.");
    ResourceViewProvider.getInstance().refresh();
    return;
  }

  // Notify the user that the file may contain secrets
  const selection = await window.showWarningMessage(
    `May contain sensitive data`,
    {
      modal: true,
      detail:
        "Exported file may contain sensitive information like API keys, secrets, and local file paths. Use caution when saving and sharing connection files.",
    },
    { title: "Export" },
    // { title: "Remove secrets" }, // TODO NC future feature
    { title: "Cancel", isCloseAffordance: true },
  );
  if (selection !== undefined && selection.title !== "Cancel") {
    const SAVE_LABEL = "Export connection";
    const folderUri = await window.showOpenDialog({
      openLabel: SAVE_LABEL,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      // Parameter might be ignored on some OSes (e.g. macOS)
      title: SAVE_LABEL,
    });

    if (!folderUri || folderUri.length !== 1) {
      // User cancelled before choosing a folder, quietly exit
      // TODO Log it maybe?
      return;
    } else {
      try {
        const shareable = { ...spec, id: undefined, extVersion: EXTENSION_VERSION };
        const specJson = JSON.stringify(shareable, null, 2);
        const destination = folderUri[0];
        const name = spec.name ? spec.name : "connection";
        const fileName = name.trim().replace(/\s+/g, "_") + ".json";
        const fileUri = Uri.joinPath(destination, fileName);
        await workspace.fs.writeFile(fileUri, new TextEncoder().encode(specJson));
        // Show success, allow user to open file in current workspace
        const openFileButton = "Open File";
        window
          .showInformationMessage(`Connection file saved at ${fileUri.path}`, openFileButton)
          .then(async (selection) => {
            if (selection === openFileButton) {
              window.showTextDocument(fileUri);
            }
          });
      } catch (err) {
        logger.error(`Failed to save file: ${err}`);
        showErrorNotificationWithButtons("Unable to save connection spec file.");
      }
    }
  }
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
    registerCommandWithLogging("confluent.connections.direct.export", exportDirectConnection),
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
