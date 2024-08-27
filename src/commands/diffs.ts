import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { StateDiffs } from "../constants";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { Logger } from "../logging";
import { Schema } from "../models/schema";
import { getStorageManager } from "../storage";

const logger = new Logger("commands.diffs");

async function selectForCompareCommand(item: any) {
  const uri: vscode.Uri = convertItemToUri(item);
  logger.info("Selected item for compare", uri);
  await getStorageManager().setWorkspaceState(StateDiffs.SELECTED_RESOURCE, uri);
  // allows the "Compare with Selected" command to be used
  await vscode.commands.executeCommand("setContext", "resourceSelectedForCompare", true);
}

async function compareWithSelectedCommand(item: any) {
  const uri2: vscode.Uri = convertItemToUri(item);
  logger.info("Comparing with selected item", uri2);

  const uri1: vscode.Uri | undefined = await getStorageManager().getWorkspaceState(
    StateDiffs.SELECTED_RESOURCE,
  );
  if (!uri1) {
    logger.error("No resource selected for compare; this shouldn't happen", uri2);
    return;
  }

  // replace fsPaths with ~ if they contain $HOME
  const uri1Path = uri1.fsPath.replace(process.env["HOME"]!, "~");
  const uri2Path = uri2.fsPath.replace(process.env["HOME"]!, "~");
  const title = `${uri1Path} ↔ ${uri2Path}`;
  logger.info("Comparing resources", uri1, uri2, title);
  vscode.commands.executeCommand("vscode.diff", uri1, uri2, title);
}

export const commands = [
  registerCommandWithLogging("confluent.diff.selectForCompare", selectForCompareCommand),
  registerCommandWithLogging("confluent.diff.compareWithSelected", compareWithSelectedCommand),
];

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
