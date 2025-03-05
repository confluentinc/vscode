import { Disposable, env, Uri, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { resourceSearchSet, schemaSearchSet, topicSearchSet } from "../emitters";
import { Logger } from "../logging";

const logger = new Logger("commands.extra");

async function openCCloudLink(item: any) {
  logger.debug("Opening Confluent Cloud link", item);
  // make sure the item has the "ccloudUrl" property
  if (!item?.ccloudUrl) {
    return;
  }
  await env.openExternal(Uri.parse(item.ccloudUrl));
}

async function openCCloudApiKeysUrl(item: any) {
  logger.debug("Opening Confluent Cloud API Keys url", item);
  // make sure the item has the "ccloudApiKeysUrl" property
  if (!item?.ccloudApiKeysUrl) {
    return;
  }
  await env.openExternal(Uri.parse(item.ccloudApiKeysUrl));
}

async function copyResourceId(item: any) {
  logger.debug("Copying resource ID", item);
  // make sure the item has the "id" property
  if (!item?.id) {
    return;
  }
  await env.clipboard.writeText(item.id);
  window.showInformationMessage(`Copied "${item.id}" to clipboard.`);
}

/** Copy the object's name to the clipboard. */
async function copyResourceName(item: any) {
  logger.debug("Copying resource name", item);
  if (!item?.name) {
    return;
  }
  await env.clipboard.writeText(item.name);
  window.showInformationMessage(`Copied "${item.name}" to clipboard.`);
}

async function copyResourceUri(item: any) {
  logger.debug("Copying resource URI", item);
  // make sure the item has the "uri" property
  if (!item?.uri) {
    return;
  }
  await env.clipboard.writeText(item.uri);
  window.showInformationMessage(`Copied "${item.uri}" to clipboard.`);
}

async function searchResources() {
  const searchString = await window.showInputBox({
    title: "Search items in the Resources view",
    ignoreFocusOut: true,
  });
  if (!searchString) {
    return;
  }
  await setContextValue(ContextValues.resourceSearchApplied, true);
  logger.debug("Searching resources");
  resourceSearchSet.fire(searchString);
}

async function clearResourceSearch() {
  logger.debug("Clearing resource search");
  await setContextValue(ContextValues.resourceSearchApplied, false);
  resourceSearchSet.fire(null);
}

async function searchTopics() {
  const searchString = await window.showInputBox({
    title: "Search items in the Topics view",
    ignoreFocusOut: true,
  });
  if (!searchString) {
    return;
  }
  await setContextValue(ContextValues.topicSearchApplied, true);
  logger.debug("Searching topics");
  topicSearchSet.fire(searchString);
}

async function clearTopicSearch() {
  logger.debug("Clearing topic search");
  await setContextValue(ContextValues.topicSearchApplied, false);
  topicSearchSet.fire(null);
}

async function searchSchemas() {
  const searchString = await window.showInputBox({
    title: "Search items in the Schemas view",
    ignoreFocusOut: true,
  });
  if (!searchString) {
    return;
  }
  await setContextValue(ContextValues.schemaSearchApplied, true);
  logger.debug("Searching schemas");
  schemaSearchSet.fire(searchString);
}

async function clearSchemaSearch() {
  logger.debug("Clearing schema search");
  await setContextValue(ContextValues.schemaSearchApplied, false);
  schemaSearchSet.fire(null);
}

export function registerExtraCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.openCCloudLink", openCCloudLink),
    registerCommandWithLogging("confluent.openCCloudApiKeysUrl", openCCloudApiKeysUrl),
    registerCommandWithLogging("confluent.copyResourceId", copyResourceId),
    registerCommandWithLogging("confluent.copyResourceName", copyResourceName),
    registerCommandWithLogging("confluent.copyResourceUri", copyResourceUri),
    registerCommandWithLogging("confluent.resources.search", searchResources),
    registerCommandWithLogging("confluent.resources.search.clear", clearResourceSearch),
    registerCommandWithLogging("confluent.topics.search", searchTopics),
    registerCommandWithLogging("confluent.topics.search.clear", clearTopicSearch),
    registerCommandWithLogging("confluent.schemas.search", searchSchemas),
    registerCommandWithLogging("confluent.schemas.search.clear", clearSchemaSearch),
  ];
}
