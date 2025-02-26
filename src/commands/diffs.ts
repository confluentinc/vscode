import { homedir } from "os";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { Logger } from "../logging";
import { Schema } from "../models/schema";
import { getStorageManager } from "../storage";
import { WorkspaceStorageKeys } from "../storage/constants";

const logger = new Logger("commands.diffs");

export async function selectForCompareCommand(item: any) {
  if (!item) {
    return;
  }
  const uri: vscode.Uri = convertItemToUri(item);
  logger.debug("Selected item for compare", uri);
  // convert to string before storing so we can Uri.parse it later since Uri is not serializable
  await getStorageManager().setWorkspaceState(WorkspaceStorageKeys.DIFF_BASE_URI, uri.toString());
  // allows the "Compare with Selected" command to be used
  await setContextValue(ContextValues.resourceSelectedForCompare, true);
}

export async function compareWithSelectedCommand(item: any) {
  if (!item) {
    return;
  }
  const uri2: vscode.Uri = convertItemToUri(item);
  logger.debug("Comparing with selected item", uri2);
  const uri1str: string | undefined = await getStorageManager().getWorkspaceState(
    WorkspaceStorageKeys.DIFF_BASE_URI,
  );
  if (!uri1str) {
    logger.error("No resource selected for compare; this shouldn't happen", uri2);
    return;
  }
  // convert back to Uri
  const uri1: vscode.Uri = vscode.Uri.parse(uri1str);

  // replace fsPaths with ~ if they contain $HOME
  const uri1Path = uri1.fsPath.replace(homedir(), "~");
  const uri2Path = uri2.fsPath.replace(homedir(), "~");
  const title = `${uri1Path} ↔ ${uri2Path}`;
  logger.debug("Comparing resources", uri1, uri2, title);
  vscode.commands.executeCommand("vscode.diff", uri1, uri2, title);
}

export function registerDiffCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.diff.selectForCompare", selectForCompareCommand),
    registerCommandWithLogging("confluent.diff.compareWithSelected", compareWithSelectedCommand),
  ];
}

/**
 * Converts a resource item to a URI for comparison.
 * @param item The resource item to convert
 * @returns The URI for the resource item
 * @throws Error if the resource item is not yet supported
 */
function convertItemToUri(item: any): vscode.Uri {
  if (item instanceof Schema) {
    return new SchemaDocumentProvider().resourceToUri(item, item.fileName());
  } else {
    throw new Error("Unsupported resource type for comparison");
  }
}
