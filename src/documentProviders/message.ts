import { Uri } from "vscode";
import { ResourceDocumentProvider } from ".";

export const MESSAGE_URI_SCHEME = "confluent.topic.message";

/** Makes a read-only editor buffer holding the contents of an event/message on a Kafka topic. */
export class MessageDocumentProvider extends ResourceDocumentProvider {
  // non-file, non-untitled URIs cause the resulting buffer to be read-only
  scheme = MESSAGE_URI_SCHEME;

  public async provideTextDocumentContent(uri: Uri): Promise<string> {
    const messagePayload = this.parseUriQueryBody(uri.query);
    return JSON.stringify(messagePayload, null, 2);
  }
}
