import { homedir } from "os";
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
   * Base implementation of converting a resource object to a URI that can be used to display the resource in a read-only editor.
   * @param scheme
   * @param resource
   * @param filename
   * @returns
   */
  static baseResourceToUri(scheme: string, resource: any, filename: string): vscode.Uri {
    return vscode.Uri.from({
      scheme,
      path: join(homedir(), filename),
      query: encodeURIComponent(JSON.stringify(resource)),
    });
  }

  /**
   * Convert a resource object to a URI that can be used to display the resource in a read-only editor.
   * @param resource The resource object
   * @param filename The filename to use for the URI
   */
  resourceToUri(resource: any, filename: string): vscode.Uri {
    return ResourceDocumentProvider.baseResourceToUri(this.scheme, resource, filename);
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
