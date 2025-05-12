import {
  CancellationToken,
  ChatContext,
  ChatRequest,
  ChatRequestTurn,
  ChatResponseStream,
  ChatResponseTurn,
  ChatResult,
  LanguageModelChat,
  LanguageModelChatMessage,
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
import { Logger } from "../logging";
import { INITIAL_PROMPT, PARTICIPANT_ID } from "./constants";
import { ModelNotSupportedError } from "./errors";
import { participantMessage, systemMessage, toolMessage, userMessage } from "./messageTypes";
import { parseReferences } from "./references";
import { summarizeChatHistory } from "./summarizers/chatHistory";
import { BaseLanguageModelTool } from "./tools/base";
import { getToolMap } from "./tools/toolMap";

const logger = new Logger("chat.participant");

/** Main handler for the Copilot chat participant. */
export async function chatHandler(
  request: ChatRequest & { model?: LanguageModelChat },
  context: ChatContext,
  stream: ChatResponseStream,
  token: CancellationToken,
): Promise<ChatResult> {
  logger.debug("received chat request", { request, context });

  const messages: LanguageModelChatMessage[] = [];

  // add the initial prompt to the messages
  messages.push(systemMessage(INITIAL_PROMPT));

  const userPrompt = request.prompt.trim();
  // check for empty request
  if (userPrompt === "" && request.references.length === 0 && request.command === undefined) {
    stream.markdown("Hmm... I don't know how to respond to that.");
    return {};
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

  const model: LanguageModelChat = await getModel({
    vendor: request.model?.vendor,
    family: request.model?.family,
    version: request.model?.version,
    id: request.model?.id,
  });
  // logger.debug(`using model id "${model.id}" for request`);

  if (request.command) {
    // TODO: implement command handling
    return { metadata: { command: request.command } };
  }

  // non-command request
  try {
    const toolsCalled: string[] = await handleChatMessage(request, model, messages, stream, token);
    return { metadata: { toolsCalled } };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("model_not_supported")) {
        // NOTE: some models returned from `selectChatModels()` may return an error 400 response
        // while streaming the response. This is out of our control, and attempting to find a fallback
        // model could get noisy and use more tokens than necessary. Instead, we're trying to catch
        // this scenario and return a more user-friendly error message.
        const errMsg = `The "${model.name}" model is not currently supported. Please choose a different model from the dropdown and try again.`;
        // keep track of how often this is happening so we can
        logError(new ModelNotSupportedError(`${model.id} is not supported`), "chatHandler", {
          extra: {
            model: JSON.stringify({ id: model.id, vendor: model.vendor, family: model.family }),
          },
        });
        return {
          errorDetails: { message: errMsg },
          metadata: { error: true, name: ModelNotSupportedError.name },
        };
      }
      // some other kind of error when sending the request or streaming the response
      logError(error, "chatHandler", { extra: { model: model?.name ?? "unknown" } });
      return {
        errorDetails: { message: error.message },
        metadata: { error: true, stack: error.stack, name: error.name },
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
    // NOTE: uncomment this when debugging locally; too noisy otherwise
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

/** Send message(s) and stream the response in markdown format. */
export async function handleChatMessage(
  request: ChatRequest,
  model: LanguageModelChat,
  messages: LanguageModelChatMessage[],
  stream: ChatResponseStream,
  token: CancellationToken,
): Promise<string[]> {
  const toolsCalled: string[] = [];
  // keep track of which calls the model has made to prevent repeats by stringifying any
  // `LanguageModelToolCallPart` results
  const toolCallsMade = new Set<string>();

  // limit number of iterations to prevent infinite loops
  let iterations = 0;
  const maxIterations = 10; // TODO: make this user-configurable?

  // inform the model that tools can be invoked as part of the response stream
  const registeredTools: BaseLanguageModelTool<any>[] = Array.from(getToolMap().values());
  const chatTools: LanguageModelChatTool[] = registeredTools.map(
    (tool: BaseLanguageModelTool<any>) => tool.toChatTool(),
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

    logChatMessages(messages);
    const response: LanguageModelChatResponse = await model.sendRequest(
      messages,
      requestOptions,
      token,
    );
    iterations++;

    for await (const fragment of response.stream) {
      if (token.isCancellationRequested) {
        logger.debug("chat request canceled");
        return toolsCalled;
      }

      if (fragment instanceof LanguageModelTextPart) {
        // basic text response
        stream.markdown(fragment.value);
      } else if (fragment instanceof LanguageModelToolCallPart) {
        // tool call: look up the tool from the map, process its invocation result(s), and continue on
        const toolCall: LanguageModelToolCallPart = fragment as LanguageModelToolCallPart;
        const tool: BaseLanguageModelTool<any> | undefined = getToolMap().get(toolCall.name);
        if (!tool) {
          const errorMsg = `Tool "${toolCall.name}" not found.`;
          logger.error(errorMsg);
          stream.markdown(errorMsg);
          return toolsCalled;
        }
        // TODO: move this into the tools themselves?
        stream.progress(tool.progressMessage);

        if (toolCallsMade.has(JSON.stringify(toolCall))) {
          // don't process the same tool call twice
          logger.debug(`Tool "${toolCall.name}" already called with input "${toolCall.input}"`);
          messages.push(
            systemMessage(
              `Tool "${toolCall.name}" already called with input "${JSON.stringify(toolCall.input)}". Do not repeatedly call tools with the same inputs. Use previous result(s) if possible.`,
            ),
          );
          continueConversation = true;
          continue;
        }

        // each registered tool should contribute its own way of handling the invocation and
        // interacting with the stream
        continueConversation = true;
        logger.debug(`Processing tool invocation for "${toolCall.name}"`, {
          params: toolCall.input,
        });
        let toolResultPart: LanguageModelToolResultPart;
        let status: "success" | "error" = "success";
        try {
          toolResultPart = await tool.processInvocation(request, stream, toolCall, token);

          // TODO(shoup): remove after debugging
          const toolDebugMessages: string[] = [];
          for (const part of toolResultPart.content) {
            if (part instanceof LanguageModelTextPart) {
              toolDebugMessages.push(part.value);
            }
          }
          logger.debug(`tool call result:\n\n${toolDebugMessages.join("\n")}`);
        } catch (error) {
          const errorMsg = `Error processing tool "${toolCall.name}": ${error}`;
          logger.error(errorMsg);
          toolResultPart = new LanguageModelToolResultPart(toolCall.callId, [
            new LanguageModelTextPart(errorMsg),
          ]);
          status = "error";
        }
        // add the Assistant message for the LanguageModelToolCallPart,
        // then a User message for the LanguageModelToolResultPart
        messages.push(
          participantMessage([toolCall]),
          toolMessage(toolCall.name, [toolResultPart], status),
        );

        toolCallsMade.add(JSON.stringify(toolCall));
        if (!toolsCalled.includes(toolCall.name)) {
          // keep track of the tools that have been called so far as part of this chat request flow
          toolsCalled.push(toolCall.name);
        }
      }
    }
  }

  return toolsCalled;
}

/** Filter the chat history to only relevant messages for the current chat. */
function filterContextHistory(
  history: readonly (ChatRequestTurn | ChatResponseTurn)[],
): LanguageModelChatMessage[] {
  // remove the last message from the history since it is the current request
  const pastMessages: (ChatRequestTurn | ChatResponseTurn)[] = history.slice(0, -1);
  logger.debug("context history:\n", JSON.stringify(pastMessages, null, 2));

  // only use messages where the participant was tagged, or messages where the participant responded
  const filteredHistory: (ChatRequestTurn | ChatResponseTurn)[] = pastMessages.filter(
    (msg) => msg.participant === PARTICIPANT_ID,
  );
  if (filteredHistory.length === 0) {
    return [];
  }

  const summary: string = summarizeChatHistory(filteredHistory);
  logger.debug("filtered context history:\n", summary);
  return [userMessage(summary)];
}

export function logChatMessages(messages: LanguageModelChatMessage[]): string {
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
