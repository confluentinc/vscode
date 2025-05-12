import {
  ChatRequestTurn,
  ChatResponseMarkdownPart,
  ChatResponseTurn,
  LanguageModelTextPart,
  MarkdownString,
} from "vscode";
import { PARTICIPANT_ID } from "../constants";
import { ToolCallMetadata } from "../tools/types";

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
      // also check if there was any tool call data in the result.metadata.toolsCalled object
      const toolCallResults: ToolCallMetadata[] = turn.result.metadata?.toolsCalled;
      if (toolCallResults && toolCallResults.length) {
        for (const toolCall of toolCallResults) {
          // LanguageModelToolCallPart:
          summary.appendMarkdown(
            `\n\nASSISTANT tool call: "${toolCall.request.name}" inputs: "${JSON.stringify(toolCall.request.input)}"`,
          );
          // TextOnlyToolResultPart(LanguageModelToolResultPart):
          const textResults: LanguageModelTextPart[] = toolCall.response.content;
          const plural = textResults.length > 1 ? "s" : "";
          summary.appendMarkdown(
            `\n\nUSER tool call result${plural}: "${toolCall.request.name}": "${textResults.map((part) => part.value).join("\n")}"`,
          );
        }
      }
    }
  }

  return summary.value;
}
