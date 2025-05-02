import * as vscode from "vscode";
import { ResourceDocumentProvider } from ".";

export const MESSAGE_URI_SCHEME = "confluent.topic.message";

/** Makes a read-only editor buffer holding the contents of an event/message on a Kafka topic. */
export class MessageDocumentProvider extends ResourceDocumentProvider {
  // non-file, non-untitled URIs cause the resulting buffer to be read-only
  scheme = MESSAGE_URI_SCHEME;

  static currentMessage: string | null = null;

  public async provideTextDocumentContent(): Promise<string> {
    // currentMessage must be set before calling `showTextDocument` or `openTextDocument`
    if (!MessageDocumentProvider.currentMessage) {
      throw new Error("No message available to display");
    }
    // grab a reference and reset it
    const documentContent = MessageDocumentProvider.currentMessage;
    MessageDocumentProvider.currentMessage = null;
    return documentContent;
  }

  /** Set the message to display in the read-only editor buffer. */
  public static set message(message: string) {
    MessageDocumentProvider.currentMessage = message;
  }
}

const MESSAGE_DOCUMENT_PROVIDER = new MessageDocumentProvider();

/**
 * Shows a preview of JSON content in a new editor window.
 * Opens the content in a new tab beside the current one, sets the language to JSON,
 * and formats the content with proper indentation.
 *
 * @param filename - Name of the file to show the preview in
 * @param json - The JSON content to preview (object or string)
 * @param resourceIdentity - (optional) Object to use for the resource identity in the URI (e.g., { partition, offset })
 * @param viewColumn - (optional) The editor column to show the preview in (default: ViewColumn.Beside)
 */
export async function showJsonPreview(
  filename: string,
  json: object | string,
  resourceIdentity: Record<string, any> = { id: -1 },
  viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
) {
  MessageDocumentProvider.message = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  const uri = MESSAGE_DOCUMENT_PROVIDER.resourceToUri(resourceIdentity, filename);
  const editor = await vscode.window.showTextDocument(uri, {
    preview: true,
    viewColumn,
    preserveFocus: false,
  });
  await vscode.languages.setTextDocumentLanguage(editor.document, "json");
}
