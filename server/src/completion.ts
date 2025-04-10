import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { getConnection } from "./connection";
import { getDocumentManager } from "./documents";
import { getKafkaClusters } from "./state";

export function handleCompletion(params: TextDocumentPositionParams): CompletionItem[] {
  const connection = getConnection();

  const document: TextDocument | undefined = getDocumentManager().get(params.textDocument.uri);
  if (!document) {
    connection.console.warn(`No document found for ${params.textDocument.uri}`);
    return [];
  }

  connection.console.log(
    `Completion requested for ${params.textDocument.uri} at position ${params.position.line}:${params.position.character}`,
  );

  // Get the text of the current line up to the cursor position
  const text = document
    .getText({
      start: { line: params.position.line, character: 0 },
      end: params.position,
    })
    .toLowerCase();
  connection.console.log(`Current line text: "${text}"`);

  if (text.includes("kafka")) {
    // list kafka cluster names
    const kafkaClusters = getKafkaClusters();
    connection.console.log(`Kafka clusters found: ${JSON.stringify(kafkaClusters)}\n\n`);
    const clusterCompletions = kafkaClusters.map((cluster, index) => ({
      label: `${cluster} (Kafka Cluster)`,
      filterText: `${cluster} kafka cluster`,
      kind: CompletionItemKind.Value,
      data: 1000 + index, // support up to 1000 clusters
      detail: "Kafka Cluster",
      documentation: `CCloud Kafka cluster name: ${cluster}`,
      insertText: text.endsWith("`") ? `${cluster}\`` : `\`${cluster}\``,
    }));
    connection.console.log(`Returning clusters:\n\n${JSON.stringify(clusterCompletions)}\n\n`);
    return clusterCompletions;
  }

  return [
    {
      label: "CREATE TABLE",
      kind: CompletionItemKind.Snippet,
      data: 1,
      insertText:
        "CREATE TABLE ${1:table_name} (\n\t${2:column_name} ${3:column_type}${4}\n) WITH (\n\t${5:connector} = ${6}\n)",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "SELECT",
      kind: CompletionItemKind.Keyword,
      data: 2,
      insertText: "SELECT ${1:*} FROM ${2:table_name}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
    {
      label: "INSERT INTO",
      kind: CompletionItemKind.Keyword,
      data: 3,
      insertText: "INSERT INTO ${1:table_name}",
      insertTextFormat: InsertTextFormat.Snippet,
    },
  ];
}

export function handleCompletionResolve(item: CompletionItem): CompletionItem {
  const connection = getConnection();

  connection.console.log(`Resolving completion for ${item.label}`);

  if (item.data === 1) {
    item.detail = "Create a new Flink SQL table";
    item.documentation =
      "Creates a new table definition with the specified columns and connector properties.";
  } else if (item.data === 2) {
    item.detail = "SELECT statement";
    item.documentation = "Query data from a table or view.";
  } else if (item.data === 3) {
    item.detail = "INSERT INTO statement";
    item.documentation = "Insert data into a table.";
  }
  return item;
}
