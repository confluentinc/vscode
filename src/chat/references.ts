import {
  ChatPromptReference,
  LanguageModelChatMessage,
  Location,
  Range,
  TextDocument,
  Uri,
  workspace,
} from "vscode";
import { Logger } from "../logging";

const logger = new Logger("chat.references");

/** Parse references from the user's chat message. */
export async function parseReferences(
  references: readonly ChatPromptReference[],
): Promise<LanguageModelChatMessage[]> {
  const referenceMessages: LanguageModelChatMessage[] = [];

  for (const reference of references) {
    const referenceMessage: LanguageModelChatMessage | undefined = await handleReference(reference);
    if (referenceMessage) {
      referenceMessages.push(referenceMessage);
    }
  }

  return referenceMessages;
}

/** Handle a single reference from the user's chat message. */
export async function handleReference(
  reference: ChatPromptReference,
): Promise<LanguageModelChatMessage | undefined> {
  logger.debug("handling reference:", reference);

  switch (reference.id) {
    // custom URI (message preview, schema definitions, etc), editor, or file
    case "vscode.implicit.viewport":
    case "vscode.untitled":
    case "vscode.file": {
      let uri: Uri;
      let range: Range | undefined;
      if (reference.value instanceof Uri) {
        uri = reference.value;
      } else if (reference.value instanceof Location) {
        // may be a selection in a document
        uri = reference.value.uri;
        range = reference.value.range;
      } else {
        logger.error("reference type not yet supported:", reference);
        return;
      }

      const title = uri.path.split("/").pop() || "Untitled";
      const document: TextDocument = await workspace.openTextDocument(uri);
      const content: string = document.getText(range);
      // TODO: clean up this formatting:
      return LanguageModelChatMessage.User(`#file:${title}:\n\n\`\`\`\n${content}\n\`\`\``, "user");
    }
    // TODO: handle other reference types
  }
}
