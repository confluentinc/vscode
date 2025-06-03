import { Disposable, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import {
  flinkStatementSearchSet,
  resourceSearchSet,
  schemaSearchSet,
  topicSearchSet,
} from "../emitters";
import { Logger } from "../logging";

const logger = new Logger("commands.search");

export function registerSearchCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.resources.search", searchResources),
    registerCommandWithLogging("confluent.resources.search.clear", clearResourceSearch),
    registerCommandWithLogging("confluent.topics.search", searchTopics),
    registerCommandWithLogging("confluent.topics.search.clear", clearTopicSearch),
    registerCommandWithLogging("confluent.schemas.search", searchSchemas),
    registerCommandWithLogging("confluent.schemas.search.clear", clearSchemaSearch),
    registerCommandWithLogging("confluent.flink.statements.search", searchFlinkStatements),
    registerCommandWithLogging(
      "confluent.flink.statements.search.clear",
      clearFlinkStatementsSearch,
    ),
  ];
}

export async function searchResources() {
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

export async function clearResourceSearch() {
  logger.debug("Clearing resource search");
  await setContextValue(ContextValues.resourceSearchApplied, false);
  resourceSearchSet.fire(null);
}

export async function searchTopics() {
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

export async function clearTopicSearch() {
  logger.debug("Clearing topic search");
  await setContextValue(ContextValues.topicSearchApplied, false);
  topicSearchSet.fire(null);
}

export async function searchSchemas() {
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

export async function clearSchemaSearch() {
  logger.debug("Clearing schema search");
  await setContextValue(ContextValues.schemaSearchApplied, false);
  schemaSearchSet.fire(null);
}

export async function searchFlinkStatements() {
  const searchString = await window.showInputBox({
    title: "Search items in the Flink Statements view",
    ignoreFocusOut: true,
  });
  if (!searchString) {
    return;
  }
  logger.debug("Searching Flink statements");
  // not setting ContextValues.flinkStatementsSearchApplied here because the view provider will handle it
  flinkStatementSearchSet.fire(searchString);
}

export async function clearFlinkStatementsSearch() {
  logger.debug("Clearing Flink statements search");
  // not setting ContextValues.flinkStatementsSearchApplied here because the view provider will handle it
  flinkStatementSearchSet.fire(null);
}
