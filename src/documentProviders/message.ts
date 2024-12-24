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
