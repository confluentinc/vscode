import {
  CancellationToken,
  ChatContext,
  ChatRequest,
  ChatRequestTurn,
  ChatResponseStream,
  ChatResponseTurn,
  LanguageModelChat,
  LanguageModelChatMessage,
  LanguageModelChatMessageRole,
  LanguageModelChatRequestOptions,
  LanguageModelChatResponse,
  LanguageModelChatSelector,
  LanguageModelChatTool,
  LanguageModelChatToolMode,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  lm,
} from "vscode";
import { logError } from "../errors";
import { CHAT_SEND_ERROR_DATA, CHAT_SEND_TOOL_CALL_DATA } from "../extensionSettings/constants";
import { Logger } from "../logging";
import { logUsage, UserEvent } from "../telemetry/events";
import { INITIAL_PROMPT, PARTICIPANT_ID } from "./constants";
import { ModelNotSupportedError } from "./errors";
import { participantMessage, systemMessage, toolMessage, userMessage } from "./messageTypes";
import { parseReferences } from "./references";
import { summarizeChatHistory } from "./summarizers/chatHistory";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./tools/base";
import { getToolMap } from "./tools/toolMap";
import { ToolCallMetadata } from "./tools/types";
import { CustomChatResult } from "./types";

const logger = new Logger("chat.participant");

/** Main handler for the Copilot chat participant. */
export async function chatHandler(
  request: ChatRequest & { model?: LanguageModelChat },
  context: ChatContext,
  stream: ChatResponseStream,
  token: CancellationToken,
): Promise<CustomChatResult> {
  logger.debug("received chat request", { request, context });

  const messages: LanguageModelChatMessage[] = [];

  // add the initial prompt to the messages
  messages.push(systemMessage(INITIAL_PROMPT));

  const model: LanguageModelChat = await getModel({
    vendor: request.model?.vendor,
    family: request.model?.family,
    version: request.model?.version,
    id: request.model?.id,
  });
  const modelInfo = getModelInfo(model);

  const userPrompt = request.prompt.trim();
  const promptTokensUsed: number = await model.countTokens(userPrompt);
  logUsage(UserEvent.CopilotInteraction, {
    status: "user prompt received",
    promptTokensUsed,
    modelInfo,
  });
  // check for empty request
  if (userPrompt === "" && request.references.length === 0 && request.command === undefined) {
    stream.markdown("Hmm... I don't know how to respond to that.");
    return { metadata: { modelInfo } };
  }

  // add historical messages to the context, along with the user prompt if provided
  const historyMessages = filterContextHistory(context.history);
  messages.push(...historyMessages);
  if (userPrompt) {
    messages.push(userMessage(request.prompt));
  }

  // add any additional references like `#file:<name>`
  if (request.references.length > 0) {
    const referenceMessages = await parseReferences(request.references);
    logger.debug(`adding ${referenceMessages.length} reference message(s)`);
    messages.push(...referenceMessages);
  }

  if (request.command) {
    logUsage(UserEvent.CopilotInteraction, {
      status: "slash command used",
      command: request.command,
      promptTokensUsed,
      modelInfo,
    });
    // Planned expansion: implement command handling and update CustomChatResult interface
    return { metadata: { modelInfo } };
  }

  const shouldSendErrorData: boolean = CHAT_SEND_ERROR_DATA.value;

  // non-command request
  try {
    const toolsCalled: ToolCallMetadata[] = await handleChatMessage(
      request,
      model,
      messages,
      stream,
      token,
    );
    logUsage(UserEvent.CopilotInteraction, {
      status: "message handling succeeded",
      promptTokensUsed,
      modelInfo,
      toolsCalled: toolsCalled.map((metadata: ToolCallMetadata) => {
        return metadata.request.name;
      }),
    });
    return { metadata: { toolsCalled, modelInfo } };
  } catch (error) {
    if (error instanceof Error) {
      logUsage(UserEvent.CopilotInteraction, {
        status: "message handling failed",
        promptTokensUsed,
        modelInfo,
        // only include error data for telemetry if the user has opted in
        error: shouldSendErrorData ? error : undefined,
      });
      if (error.message.includes("model_not_supported")) {
        // NOTE: some models returned from `selectChatModels()` may return an error 400 response
        // while streaming the response. This is out of our control, and attempting to find a fallback
        // model could get noisy and use more tokens than necessary. Instead, we're trying to catch
        // this scenario and return a more user-friendly error message.
        const errMsg = `The "${model.name}" model is not currently supported. Please choose a different model from the dropdown and try again.`;
        // keep track of how often this is happening so we can
        logError(new ModelNotSupportedError(`${model.id} is not supported`), "chatHandler", {
          extra: {
            model: JSON.stringify(modelInfo),
          },
        });
        return {
          errorDetails: { message: errMsg },
          metadata: { modelInfo },
        };
      }
      // some other kind of error when sending the request or streaming the response
      logError(error, "chatHandler", { extra: { model: JSON.stringify(modelInfo) } });
      return {
        errorDetails: { message: error.message },
        metadata: { modelInfo },
      };
    }
    throw error;
  }
}

/** Get the language model to use based on the model selected in the chat dropdown. If the model
 * isn't found, try to find a model by generalizing the selector. */
async function getModel(selector: LanguageModelChatSelector): Promise<LanguageModelChat> {
  let models: LanguageModelChat[] = [];
  for (const fieldToRemove of ["id", "version", "family", "vendor"]) {
    models = await lm.selectChatModels(selector);
    // NOTE: uncomment for local debugging; this can be noisy otherwise
    // logger.debug(`${models.length} available chat model(s)`, { models, modelSelector: selector });
    if (models.length) {
      break;
    }
    // remove one field to try more generic model listing and try again
    selector = { ...selector, [fieldToRemove]: undefined };
  }

  if (!models.length) {
    throw new Error(`no language models found for ${JSON.stringify(selector)}`);
  }

  const selectedModel = models[0];
  logger.debug("using language model:", selectedModel);
  return selectedModel;
}

function getModelInfo(model: LanguageModelChat): Record<string, any> {
  const modelInfo: Record<string, any> = {
    name: model.name,
    id: model.id,
    vendor: model.vendor,
    family: model.family,
    version: model.version,
    maxInputTokens: model.maxInputTokens,
    // not part of the interface, but looks something like this:
    // { supportsImageToText: true, supportsToolCalling: true }
    capabilities: (model as any).capabilities,
  };
  return modelInfo;
}

/** Send message(s) and stream the response in markdown format. */
export async function handleChatMessage(
  request: ChatRequest,
  model: LanguageModelChat,
  messages: LanguageModelChatMessage[],
  stream: ChatResponseStream,
  token: CancellationToken,
): Promise<ToolCallMetadata[]> {
  // capture results to return as ChatResult.metadata to prevent the model from having to repeat
  // the tool calls after subsequent requests
  const toolCallMetadata: ToolCallMetadata[] = [];
  // keep track of which calls the model has made to prevent repeats by stringifying any
  // `LanguageModelToolCallPart` results
  const toolCallsMade = new Set<string>();

  // top-level telemetry data that won't change as a result of tool call iterations for this request
  const modelInfo = getModelInfo(model);
  const promptTokensUsed: number = await model.countTokens(request.prompt);

  // limit number of iterations to prevent infinite loops
  let iterations = 0;
  const maxIterations = 10; // Should we make this user-configurable?

  // inform the model that tools can be invoked as part of the response stream
  const registeredTools: BaseLanguageModelTool<any>[] = Array.from(getToolMap().values());
  const chatTools: LanguageModelChatTool[] = registeredTools.map(
    (tool: BaseLanguageModelTool<any>) => tool.toChatTool(),
  );
  // keep this around for debugging new tools to make sure they are registered correctly
  logger.debug(
    "registered tools:",
    chatTools.map((tool) => tool.name),
  );
  const requestOptions: LanguageModelChatRequestOptions = {
    tools: chatTools,
    toolMode: LanguageModelChatToolMode.Auto,
  };
  // determine whether or not to continue sending chat requests to the model as a result of any tool
  // calls
  let continueConversation = true;
  while (continueConversation && iterations < maxIterations) {
    continueConversation = false;

    // NOTE: uncomment for local debugging
    // debugLogChatMessages(messages);

    const latestMessage: LanguageModelChatMessage = messages[messages.length - 1];
    const isNotUserMessage: boolean = latestMessage.role !== LanguageModelChatMessageRole.User;
    const isNotTextPart: boolean =
      latestMessage.content.length === 0 ||
      latestMessage.content[0] instanceof LanguageModelToolResultPart;
    if (isNotUserMessage || isNotTextPart) {
      // the latest message needs to be a `User` message, and on older versions of the Copilot Chat
      // extension (<0.27.0), it also can't be a tool result, so we have to add a new User message
      // to the end of the messages array
      messages.push(userMessage(request.prompt));
    }

    const response: LanguageModelChatResponse = await model.sendRequest(
      messages,
      requestOptions,
      token,
    );
    iterations++;

    // dynamic telemetry data that may change as a result of tool call iterations
    const toolsCalled: string[] = toolCallMetadata.map((metadata: ToolCallMetadata) => {
      return metadata.request.name;
    });
    const previousMessageCount: number = messages.length;
    // also check user/workspace settings to see if we can send tool call data with telemetry
    const shouldSendToolCallData: boolean = CHAT_SEND_TOOL_CALL_DATA.value;

    for await (const fragment of response.stream) {
      if (token.isCancellationRequested) {
        logger.debug("chat request canceled");
        logUsage(UserEvent.CopilotInteraction, {
          status: "message handling canceled by user",
          promptTokensUsed,
          modelInfo,
          previousMessageCount,
          toolsCalled,
          toolCallIteration: iterations,
        });
        return toolCallMetadata;
      }

      if (fragment instanceof LanguageModelTextPart) {
        // basic text response
        stream.markdown(fragment.value);
      } else if (fragment instanceof LanguageModelToolCallPart) {
        // tool call: look up the tool from the map, process its invocation result(s), and continue on
        const toolCall: LanguageModelToolCallPart = fragment;
        const tool: BaseLanguageModelTool<any> | undefined = getToolMap().get(toolCall.name);
        logUsage(UserEvent.CopilotInteraction, {
          status: "tool call received from model",
          promptTokensUsed,
          modelInfo,
          previousMessageCount,
          toolsCalled,
          toolCallIteration: iterations,
          toolName: toolCall.name,
          toolCallInput: shouldSendToolCallData ? JSON.stringify(toolCall.input) : undefined,
        });
        if (!tool) {
          const errorMsg = `Tool "${toolCall.name}" not found.`;
          logger.error(errorMsg);
          stream.markdown(errorMsg);
          return toolCallMetadata;
        }

        // don't stringify the entire tool call object since the `callId` will change each time
        const toolCallString = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
        if (toolCallsMade.has(toolCallString)) {
          // don't process the same tool call twice
          logger.debug(`Tool "${toolCall.name}" already called with input "${toolCall.input}"`);
          messages.push(
            systemMessage(
              `Tool "${toolCall.name}" already called with input "${JSON.stringify(toolCall.input)}". Do not repeatedly call tools with the same inputs. Refer to previous tool results in the conversation history.`,
            ),
          );
          continueConversation = true;
          continue;
        }
        toolCallsMade.add(toolCallString);

        // each registered tool should contribute its own way of handling the invocation and
        // interacting with the stream
        continueConversation = true;
        logger.debug(`Processing tool invocation for "${toolCall.name}"`, {
          params: toolCall.input,
        });
        let toolResultPart: TextOnlyToolResultPart;
        let status: "success" | "error" = "success";

        try {
          toolResultPart = await tool.processInvocation(request, stream, toolCall, token);

          // (shoup): remove after debugging
          const toolDebugMessages: string[] = [];
          for (const part of toolResultPart.content) {
            toolDebugMessages.push(part.value);
          }
          logger.debug(`tool call result:\n\n${toolDebugMessages.join("\n")}`);
        } catch (error) {
          const errorMsg = `Error processing tool "${toolCall.name}": ${error}`;
          logger.error(errorMsg);
          toolResultPart = new TextOnlyToolResultPart(toolCall.callId, [
            new LanguageModelTextPart(errorMsg),
          ]);
          status = "error";
        }

        logUsage(UserEvent.CopilotInteraction, {
          status: `tool invocation ${status}`,
          promptTokensUsed,
          modelInfo,
          previousMessageCount,
          toolsCalled,
          toolCallIteration: iterations,
          toolName: toolCall.name,
          toolCallInput: shouldSendToolCallData ? JSON.stringify(toolCall.input) : undefined,
        });

        // add the Assistant message for the LanguageModelToolCallPart,
        // then a User message for the LanguageModelToolResultPart
        // (XXX: removing either one of these will result in error 400 responses from Copilot)
        messages.push(
          participantMessage([toolCall]),
          toolMessage(toolCall.name, [toolResultPart], status),
        );

        // add the tool result to the metadata for future chat requests
        toolCallMetadata.push({
          request: toolCall,
          response: toolResultPart,
        });
      }
    }
  }

  return toolCallMetadata;
}

/** Filter the chat history to only relevant messages for the current chat. */
function filterContextHistory(
  history: readonly (ChatRequestTurn | ChatResponseTurn)[],
): LanguageModelChatMessage[] {
  logger.debug("context history:\n", JSON.stringify(history, null, 2));

  // only use messages where the participant was tagged, or messages where the participant responded
  const filteredHistory: (ChatRequestTurn | ChatResponseTurn)[] = history.filter(
    (msg) => msg.participant === PARTICIPANT_ID,
  );
  if (filteredHistory.length === 0) {
    return [];
  }

  const summary: string = summarizeChatHistory(filteredHistory);
  logger.debug("filtered context history:\n", summary);
  return [userMessage(summary)];
}

/** Log chat messages from conversation history for local development and debugging. */
export function debugLogChatMessages(messages: LanguageModelChatMessage[]): string {
  const output: string[] = ["=== CHAT MESSAGES ==="];

  messages.forEach((message, index) => {
    const role = message.role === 1 ? "USER" : "ASSISTANT";
    output.push(
      `\n[Message ${index + 1}] ${role}${message.name ? ` (name="${message.name}")` : ""}`,
    );

    if (message.content.length === 0) {
      output.push("(no content)");
      return;
    }

    message.content.forEach((part, partIndex) => {
      output.push(`  [Part ${partIndex + 1}]`);

      if (part instanceof LanguageModelTextPart) {
        output.push(`  Type: LanguageModelTextPart`);

        output.push(`  "${part.value}"`);
      } else if (part instanceof LanguageModelToolCallPart) {
        // tool call request
        output.push(`  LanguageModelToolCallPart (tool="${part.name}", callId=${part.callId})`);

        try {
          const inputStr =
            typeof part.input === "object" ? JSON.stringify(part.input, null, 2) : part.input;
          output.push(`  Input: ${inputStr}`);
        } catch (e) {
          output.push(`  Input: [Error parsing input: ${e}]`);
        }
      } else if (part instanceof LanguageModelToolResultPart) {
        // tool call result/response
        output.push(`  LanguageModelToolResultPart (callId=${part.callId})`);

        if (part.content.length === 0) {
          output.push(`  Result: Empty`);
        } else {
          output.push(`  Results:`);
          part.content.forEach((resultItem, resultIndex) => {
            if (resultItem instanceof LanguageModelTextPart) {
              output.push(`    [${resultIndex + 1}] Text: ${resultItem.value}`);
            } else {
              output.push(
                `    [${resultIndex + 1}] Unknown result type: ${JSON.stringify(resultItem, null, 2)}`,
              );
            }
          });
        }
      } else {
        output.push(`  Type: Unknown (${part})`);
        output.push(`  Properties: ${JSON.stringify(part, null, 2)}`);
      }
    });
  });

  const formattedOutput = output.join("\n");
  logger.debug(formattedOutput);
  return formattedOutput;
}
