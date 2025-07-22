import { Disposable, Uri, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { getCCloudAuthSession } from "../authn/utils";
import { EXTENSION_VERSION } from "../constants";
import { openDirectConnectionForm } from "../directConnect";
import { DirectConnectionManager } from "../directConnectManager";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { KRB5_CONFIG_PATH, SSL_PEM_PATHS } from "../extensionSettings/constants";
import { Logger } from "../logging";
import { DirectEnvironment } from "../models/environment";
import { ConnectionId } from "../models/resource";
import { showErrorNotificationWithButtons } from "../notifications";
import { deleteCCloudConnection } from "../sidecar/connections/ccloud";
import { SecretStorageKeys } from "../storage/constants";
import {
  CustomConnectionSpec,
  CustomConnectionSpecFromJSON,
  getResourceManager,
} from "../storage/resourceManager";
import { getSecretStorage } from "../storage/utils";
import { readFile, writeFile } from "../utils/fsWrappers";
import { DirectConnectionRow } from "../viewProviders/newResources";
import { ResourceViewProvider } from "../viewProviders/resources";

const logger = new Logger("commands.connections");

/** Allow CCloud sign-in via the auth provider outside of the Accounts section of the VS Code UI. */
export async function ccloudSignInCommand() {
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

export async function ccloudSignOutCommand() {
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

  // sign out by clearing the stored auth session, and also clear any previous connected state
  // so ccloudStateHandling doesn't see old state and incorrectly show an expiration notification
  await Promise.all([
    deleteCCloudConnection(),
    getSecretStorage().delete(SecretStorageKeys.CCLOUD_STATE),
  ]);

  // this will trigger the auth provider's `.handleSessionRemoved(true)` and fire the
  // ccloudConnected event, which covers the rest of the `.removeSession()` logic
  ccloudAuthSessionInvalidated.fire();
}

/** Show the Open File dialog to let the user pick a .pem file and store it in the extension configs. */
export async function addSSLPemPathCommand() {
  const newPemUris: Uri[] | undefined = await window.showOpenDialog({
    openLabel: "Select",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "PEM Files": ["pem"],
    },
  });

  const paths: string[] = SSL_PEM_PATHS.value;
  if (newPemUris && newPemUris.length > 0) {
    const newPemPath: string = newPemUris[0].fsPath;
    if (newPemPath.endsWith(".pem")) {
      paths.push(newPemPath);
      await SSL_PEM_PATHS.update(paths, true);
      // no notification here since the setting will update in real-time when an item is added
    } else {
      // shouldn't be possible to get here since we restrict the file types in the dialog, but we
      // should include this because we can't do any kind of validation in the config itself for
      // array types
      window.showErrorMessage("SSL/TLS PEM file path not added. Please select a .pem file.");
    }
  }
}

export async function createNewDirectConnectionCommand() {
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
        const fileContent = await readFile(Uri.file(newSpecPath));
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

export async function deleteDirectConnectionCommand(item: DirectEnvironment | DirectConnectionRow) {
  if (!(item instanceof DirectEnvironment || item instanceof DirectConnectionRow)) {
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

export async function editDirectConnectionCommand(item: ConnectionId | DirectEnvironment) {
  // if the user clicked on the "Edit" button in the Resources view, the item will be a DirectEnvironment
  // otherwise, this was triggered via the commands API and should have been passed a ConnectionId arg
  if (
    !(
      item instanceof DirectConnectionRow ||
      item instanceof DirectEnvironment ||
      typeof item === "string"
    )
  ) {
    return;
  }

  const connectionId = typeof item === "string" ? item : item.connectionId;

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

export async function exportDirectConnectionCommand(item: DirectEnvironment | DirectConnectionRow) {
  if (!(item instanceof DirectEnvironment || item instanceof DirectConnectionRow)) {
    return;
  }

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
    // { title: "Remove secrets" }, // https://github.com/confluentinc/vscode/issues/1965
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
      return;
    } else {
      try {
        const shareable = { ...spec, id: undefined, extVersion: EXTENSION_VERSION };
        const specJson = JSON.stringify(shareable, null, 2);
        const destination = folderUri[0];
        const name = spec.name ? spec.name : "connection";
        const fileName = name.trim().replace(/\s+/g, "_") + ".json";
        const fileUri = Uri.joinPath(destination, fileName);
        await writeFile(fileUri, new TextEncoder().encode(specJson));
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

export async function setKrb5ConfigPathCommand() {
  const uris: Uri[] | undefined = await window.showOpenDialog({
    openLabel: "Select Kerberos config",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "Kerberos Config": ["conf"],
      "All Files": ["*"],
    },
  });

  if (uris && uris.length > 0) {
    const selectedPath = uris[0].fsPath;
    if (selectedPath.endsWith(".conf")) {
      await KRB5_CONFIG_PATH.update(selectedPath, true);
      window.showInformationMessage(`Kerberos config path set to: ${selectedPath}`);
    } else {
      window.showErrorMessage("No file selected. Please select a krb5.conf file.");
    }
  }
}

export function registerConnectionCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.connections.ccloud.signIn", ccloudSignInCommand),
    registerCommandWithLogging("confluent.connections.ccloud.signOut", ccloudSignOutCommand),
    registerCommandWithLogging("confluent.connections.addSSLPemPath", addSSLPemPathCommand),
    registerCommandWithLogging("confluent.connections.direct", createNewDirectConnectionCommand),
    registerCommandWithLogging(
      "confluent.connections.direct.delete",
      deleteDirectConnectionCommand,
    ),
    registerCommandWithLogging("confluent.connections.direct.edit", editDirectConnectionCommand),
    registerCommandWithLogging(
      "confluent.connections.direct.export",
      exportDirectConnectionCommand,
    ),
    registerCommandWithLogging("confluent.connections.setKrb5ConfigPath", setKrb5ConfigPathCommand),
  ];
}

/** Get the path(s) of the SSL/TLS PEM file(s) based on the user's configuration. */
export function getSSLPemPaths(): string[] {
  const paths: string[] = SSL_PEM_PATHS.value;
  // filter out paths that are empty strings or don't end with .pem since the user can manually edit
  // the setting if they don't go through the `addSSLPEMPath` command
  return paths.filter((path) => path && path.endsWith(".pem"));
}
