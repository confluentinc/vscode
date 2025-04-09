import {
  CompletionItem,
  Diagnostic,
  DidChangeConfigurationNotification,
  DocumentDiagnosticReportKind,
  InitializeParams,
  InitializeResult,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  type DocumentDiagnosticReport,
} from "vscode-languageserver/node";
import { handleCompletion, handleCompletionResolve } from "./completion";
import { getConnection } from "./connection";
import { validateTextDocument } from "./diagnostics";
import { getDocumentManager } from "./documents";

const connection = getConnection();

connection.console.info("Flink SQL Language Server starting...");

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

const documents = getDocumentManager();

documents.onDidOpen((e) => {
  connection.console.log(`Document opened: ${e.document.uri} (${e.document.languageId})`);
});

// INITIALIZATION

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
  };
  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }
  return result;
});

// either register for all configuration changes or just for the ones for workspace changes
connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

// DIAGNOSTICS

connection.languages.diagnostics.on(async (params) => {
  const document = documents.get(params.textDocument.uri);

  const documentDiagnostics: Diagnostic[] = [];
  if (document !== undefined) {
    const diagnostics: Diagnostic[] = await validateTextDocument(document);
    documentDiagnostics.push(...diagnostics);
  }

  return {
    kind: DocumentDiagnosticReportKind.Full,
    items: documentDiagnostics,
  } satisfies DocumentDiagnosticReport;
});

// DOCUMENT HANDLING
documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

connection.onDidChangeWatchedFiles((_change) => {
  connection.console.log("Received a file change event");
});

// AUTO COMPLETION
connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
  return handleCompletion(_textDocumentPosition);
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return handleCompletionResolve(item);
});

// start listening to messages passed from the client / extension instance
connection.listen();
