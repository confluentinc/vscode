import { readFile } from "fs/promises";
import { ChatPromptReference, LanguageModelChatMessage, Uri } from "vscode";
import { Logger } from "../logging";
import { PARTICIPANT_ID } from "./constants";

const logger = new Logger("chat.references");

/** Parse references from the user's chat message. */
export async function parseReferences(
  references: readonly ChatPromptReference[],
): Promise<LanguageModelChatMessage[]> {
  const referenceMessages: LanguageModelChatMessage[] = [];

  for (const reference of references) {
    const referenceMessage = await handleReference(reference);
    referenceMessages.push(referenceMessage);
  }

  return referenceMessages;
}

/** Handle a single reference from the user's chat message. */
export async function handleReference(
  reference: ChatPromptReference,
): Promise<LanguageModelChatMessage> {
  logger.debug("handling reference:", reference);

  switch (reference.id) {
    case "file": {
      const fileUri = Uri.from(reference.value as Uri);
      const fileContent = await readFile(fileUri.fsPath, "utf8");
      return LanguageModelChatMessage.User(
        `${fileUri.path}:\n\n\`\`\`\n${fileContent}\n\`\`\``,
        "user",
      );
    }
    case "copilot.selection":
      return LanguageModelChatMessage.User(`${reference.value}`, "user");
    // TODO: handle other reference types
    default:
      return LanguageModelChatMessage.Assistant(
        "I don't know how to handle this reference",
        PARTICIPANT_ID,
      );
  }
}
