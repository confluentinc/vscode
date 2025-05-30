import {
  ChatResultFeedback,
  ChatResultFeedbackKind,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { CHAT_SEND_ERROR_DATA, CHAT_SEND_TOOL_CALL_DATA } from "../extensionSettings/constants";
import { logUsage, UserEvent } from "../telemetry/events";
import { ToolCallMetadata } from "./tools/types";
import { CustomChatResult } from "./types";

export function handleFeedback(feedback: ChatResultFeedback): void {
  logUsage(UserEvent.CopilotInteraction, {
    status: "feedback provided",
    // only includes error info and tool call metadata, not the prompt or final response text
    chatResult: sanitizeFeedbackResult(feedback.result as CustomChatResult),
    isHelpful: feedback.kind === ChatResultFeedbackKind.Helpful,
  });
}

/**
 * Check user/workspace configurations to determine what parts of {@link CustomChatResult} the user
 * has opted in to sending.
 */
export function sanitizeFeedbackResult(result: CustomChatResult): Record<string, any> {
  const newResult: Record<string, any> = {};

  // always send the model info if we have it
  const modelInfo = result.metadata?.modelInfo;
  if (modelInfo) {
    newResult.modelInfo = modelInfo;
  }

  const config: WorkspaceConfiguration = workspace.getConfiguration();
  // check if the user is opting in to sending error data
  const shouldSendErrorData: boolean = config.get(CHAT_SEND_ERROR_DATA, false);
  if (shouldSendErrorData) {
    newResult.errorDetails = result.errorDetails;
  }

  // check if the user is opting in to sending tool call inputs and tool result contents
  const shouldSendToolCallData: boolean = config.get(CHAT_SEND_TOOL_CALL_DATA, false);
  if (shouldSendToolCallData) {
    newResult.toolsCalled = result.metadata?.toolsCalled;
  }
  // always send the tool call names if tools were called
  const toolCalls: ToolCallMetadata[] | undefined = result.metadata?.toolsCalled;
  if (toolCalls !== undefined && toolCalls.length) {
    newResult.toolCallNames = toolCalls.map((metadata: ToolCallMetadata) => {
      return metadata.request.name;
    });
  }

  return newResult;
}
