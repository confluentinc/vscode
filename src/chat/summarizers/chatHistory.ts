import {
  ChatRequestTurn,
  ChatResponseMarkdownPart,
  ChatResponseTurn,
  MarkdownString,
} from "vscode";
import { PARTICIPANT_ID } from "../constants";

export function summarizeChatHistory(
  history: readonly (ChatRequestTurn | ChatResponseTurn)[],
): string {
  let summary = new MarkdownString("These are the previous messages in the conversation:");

  for (const turn of history) {
    if (turn.participant !== PARTICIPANT_ID) {
      // skip messages for/from other participants
      continue;
    }

    // requests from the user:
    if (turn instanceof ChatRequestTurn) {
      summary.appendMarkdown(`\n\nUSER: "${turn.prompt}"`);
      continue;
    }

    // responses from the assistant:
    if (turn instanceof ChatResponseTurn) {
      // unlike requests, responses can have multiple parts, so we need to iterate through them
      for (const part of turn.response) {
        if (part instanceof ChatResponseMarkdownPart) {
          summary.appendMarkdown(`\n\nASSISTANT: "${part.value.value}"`);
        }
      }
    }
  }

  return summary.value;
}
