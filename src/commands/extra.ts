import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";

const logger = new Logger("commands.extra");

async function openCCloudLink(item: any) {
  logger.debug("Opening Confluent Cloud link", item);
  // make sure the item has the "ccloudUrl" property
  if (!item?.ccloudUrl) {
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(item.ccloudUrl));
}

async function copyResourceId(item: any) {
  logger.debug("Copying resource ID", item);
  // make sure the item has the "id" property
  if (!item?.id) {
    return;
  }
  await vscode.env.clipboard.writeText(item.id);
  vscode.window.showInformationMessage(`Copied "${item.id}" to clipboard.`);
}

/** Copy the object's name (or, in case of schemas, their subject) to the clipboard. */
async function copyResourceName(item: any) {
  logger.debug("Copying resource name", item);
  // make sure the item has the "name" property. Or, for schemas, we can use "subject" as a fallback.
  if (!item?.name && !item?.subject) {
    return;
  }
  const effectiveName = item.name ? item.name : item.subject;
  await vscode.env.clipboard.writeText(effectiveName);
  vscode.window.showInformationMessage(`Copied "${effectiveName}" to clipboard.`);
}

async function copyResourceUri(item: any) {
  logger.debug("Copying resource URI", item);
  // make sure the item has the "uri" property
  if (!item?.uri) {
    return;
  }
  await vscode.env.clipboard.writeText(item.uri);
  vscode.window.showInformationMessage(`Copied "${item.uri}" to clipboard.`);
}

export function registerExtraCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.openCCloudLink", openCCloudLink),
    registerCommandWithLogging("confluent.copyResourceId", copyResourceId),
    registerCommandWithLogging("confluent.copyResourceName", copyResourceName),
    registerCommandWithLogging("confluent.copyResourceUri", copyResourceUri),
  ];
}
