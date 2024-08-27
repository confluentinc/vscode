import { join } from "path";
import * as vscode from "vscode";

/**
 * An abstract implementation of the TextDocumentContentProvider that provides read-only content for
 * Confluent/Kafka resources that can be diffed.
 *
 * Sublcasses must provide their own `scheme` and `provideTextDocumentContent` implementations.
 */
export abstract class ResourceDocumentProvider implements vscode.TextDocumentContentProvider {
  abstract scheme: string;

  abstract provideTextDocumentContent(uri: vscode.Uri): Promise<string>;

  /**
   * Convert a resource object to a URI that can be used to display the resource in a read-only editor.
   * @param kind The kind of resource (e.g. "schema")
   * @param resource The resource object
   * @param filename The filename to use for the URI
   */
  resourceToUri(resource: any, filename: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: this.scheme,
      path: join(process.env["HOME"]!, filename),
      query: encodeURIComponent(JSON.stringify(resource)),
    });
  }

  /**
   * Parse a URI query string into a resource object.
   * @param query The query string to parse
   * @returns The original resource as an `object`
   */
  parseUriQueryBody(query: string): object {
    const decodedQuery = decodeURIComponent(query);
    return JSON.parse(decodedQuery);
  }
}
