import { Disposable, Uri, window, WorkspaceConfiguration } from "vscode";
import { registerCommandWithLogging } from ".";
import { getConfigs } from "../configs";
import { Logger } from "../logging";
import { getCCloudAuthSession } from "../sidecar/connections";

const logger = new Logger("commands.connections");

export const SSL_PEM_PATHS_SETTING_NAME = "ssl.pemPaths";

/** Allow CCloud sign-in via the auth provider outside of the Accounts section of the VS Code UI. */
async function createConnectionCommand() {
  try {
    await getCCloudAuthSession(true);
  } catch (error) {
    logger.error("error creating CCloud connection", { error });
    if (error instanceof Error) {
      // if the user clicks "Cancel" on the modal before the sign-in process, we don't need to do anything
      if (error.message === "User did not consent to login.") {
        return;
      }
      // any other errors will be caught by the error handler in src/commands/index.ts as part of the
      // registerCommandWithLogging wrapper
      throw error;
    }
  }
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

  const config: WorkspaceConfiguration = getConfigs();
  const paths: string[] = config.get(SSL_PEM_PATHS_SETTING_NAME, []);
  if (newPemUris && newPemUris.length > 0) {
    const newPemPath: string = newPemUris[0].fsPath;
    if (newPemPath.endsWith(".pem")) {
      paths.push(newPemPath);
      config.update(SSL_PEM_PATHS_SETTING_NAME, paths, true);
      // no notification here since the setting will update in real-time when an item is added
    } else {
      // shouldn't be possible to get here since we restrict the file types in the dialog, but we
      // should include this because we can't do any kind of validation in the config itself for
      // array types
      window.showErrorMessage("SSL/TLS PEM file path not added. Please select a .pem file.");
    }
  }
}

export function registerConnectionCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.connections.create", createConnectionCommand),
    registerCommandWithLogging("confluent.connections.addSSLPemPath", addSSLPemPath),
  ];
}

/** Get the path(s) of the SSL/TLS PEM file(s) based on the user's configuration. */
export function getSSLPemPaths(): string[] {
  const paths: string[] = getConfigs().get(SSL_PEM_PATHS_SETTING_NAME, []);
  // filter out paths that are empty strings or don't end with .pem since the user can manually edit
  // the setting if they don't go through the `addSSLPEMPath` command
  return paths.filter((path) => path && path.endsWith(".pem"));
}
