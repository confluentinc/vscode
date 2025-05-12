import {
  LanguageModelChatMessage,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from "vscode";
import { PARTICIPANT_ID } from "./constants";

/**
 * Returns a {@link LanguageModelChatMessage.User User message} with a "user" tag to clearly
 * distinguish it from other `User` message implementations.
 *
 * This should only be used for the most recent {@link ChatRequest.prompt} and any historic messages.
 */
export function userMessage(message: string) {
  return LanguageModelChatMessage.User(message, "user");
}

/**
 * Returns an {@link LanguageModelChatMessage.Assistant Assistant message} with a participant tag as
 * the {@linkcode PARTICIPANT_ID} to clearly separate it from other `Assistant` message implementations.
 */
export function participantMessage(message: string | LanguageModelToolCallPart[]) {
  return LanguageModelChatMessage.Assistant(message, PARTICIPANT_ID);
}

// TODO: update this if the `LanguageModelChatMessage` API changes and a `System` message is added
/**
 * Prefix and tag a {@link LanguageModelChatMessage.User User message} message to treat as a
 * `System` message for providing additional context.
 */
export function systemMessage(message: string) {
  return LanguageModelChatMessage.User(`SYSTEM: ${message}`, "system");
}

/**
 * Returns a {@link LanguageModelChatMessage.User User message} with a "tool" tag to clearly
 * distinguish it from other `User` message implementations.
 *
 * This should be used to wrap the {@link LanguageModelToolResultPart}s of a tool invocation.
 */
export function toolMessage(
  toolName: string,
  results: LanguageModelToolResultPart[],
  status?: string,
): LanguageModelChatMessage {
  let roleName = `tool:${toolName}`;
  if (status !== undefined) {
    roleName = `${roleName}:${status}`;
  }
  return LanguageModelChatMessage.User(results, roleName);
}
