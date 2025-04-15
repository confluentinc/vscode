import {
  CancellationToken,
  ChatContext,
  ChatRequest,
  ChatRequestTurn,
  ChatResponseMarkdownPart,
  ChatResponseStream,
  ChatResponseTurn,
  ChatResult,
  LanguageModelChat,
  LanguageModelChatMessage,
  LanguageModelChatRequestOptions,
  LanguageModelChatResponse,
  LanguageModelChatSelector,
  LanguageModelChatToolMode,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  lm,
} from "vscode";
import { logError } from "../errors";
import { Logger } from "../logging";
import { INITIAL_PROMPT, PARTICIPANT_ID } from "./constants";
import { ModelNotSupportedError } from "./errors";
import { participantMessage, systemMessage, userMessage } from "./messageTypes";
import { parseReferences } from "./references";
import { BaseLanguageModelTool } from "./tools/base";
import { ListTemplatesTool } from "./tools/listTemplates";
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
  logger.debug(`using model id "${model.id}" for request`);

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
        logError(
          new ModelNotSupportedError(`${model.id} is not supported`),
          "chatHandler",
          {
            model: JSON.stringify({ id: model.id, vendor: model.vendor, family: model.family }),
          },
          true,
        );
        return {
          errorDetails: { message: errMsg },
          metadata: { error: true, name: ModelNotSupportedError.name },
        };
      }
      // some other kind of error when sending the request or streaming the response
      logError(error, "chatHandler", { model: model?.name ?? "unknown" });
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
    logger.debug(`${models.length} available chat model(s)`, { models, modelSelector: selector });
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

  // hint at focusing recency instead of attempting to (re)respond to older messages
  messages.push(
    systemMessage(
      "Focus on answering the user's most recent query directly unless explicitly asked to address previous messages.",
    ),
  );

  // inform the model that tools can be invoked as part of the response stream
  const requestOptions: LanguageModelChatRequestOptions = {
    tools: [new ListTemplatesTool().toChatTool()],
    toolMode: LanguageModelChatToolMode.Auto,
  };
  // determine whether or not to continue sending chat requests to the model as a result of any tool
  // calls
  let continueConversation = true;
  while (continueConversation && iterations < maxIterations) {
    continueConversation = false;

    const response: LanguageModelChatResponse = await model.sendRequest(
      messages,
      requestOptions,
      token,
    );
    iterations++;

    const toolResultMessages: LanguageModelChatMessage[] = [];
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
        // interacting with the stream, and can return an array of messages to be sent for another
        // round of processing
        logger.debug(`Processing tool invocation for "${toolCall.name}"`);
        const newMessages: LanguageModelChatMessage[] = await tool.processInvocation(
          request,
          stream,
          toolCall,
          token,
        );
        toolResultMessages.push(...newMessages);

        toolCallsMade.add(JSON.stringify(toolCall));
        if (!toolsCalled.includes(toolCall.name)) {
          // keep track of the tools that have been called so far as part of this chat request flow
          toolsCalled.push(toolCall.name);
        }
      }
    }

    if (toolResultMessages.length) {
      // add results to the messages and let the model process them and decide what to do next
      messages.push(...toolResultMessages);
      messages.push(
        systemMessage("Please continue the conversation using the information from the tool call."),
      );
      continueConversation = true;
    }
  }

  return toolsCalled;
}

/** Filter the chat history to only relevant messages for the current chat. */
function filterContextHistory(
  history: readonly (ChatRequestTurn | ChatResponseTurn)[],
): LanguageModelChatMessage[] {
  logger.debug("context history:", history);

  // only use messages where the participant was tagged, or messages where the participant responded
  const filteredHistory: (ChatRequestTurn | ChatResponseTurn)[] = history.filter(
    (msg) => msg.participant === PARTICIPANT_ID,
  );
  if (filteredHistory.length === 0) {
    return [];
  }
  const messages: LanguageModelChatMessage[] = [];
  for (const turn of filteredHistory) {
    // don't re-use previous prompts since the model may misinterpret them as part of the current prompt
    if (turn instanceof ChatRequestTurn) {
      if (turn.participant === PARTICIPANT_ID) {
        messages.push(userMessage(turn.prompt));
      }
      continue;
    }
    if (turn instanceof ChatResponseTurn) {
      // responses from the participant:
      if (turn.response instanceof ChatResponseMarkdownPart) {
        messages.push(participantMessage(turn.response.value.value));
      }
    }
  }

  logger.debug("filtered messages for historic context:", messages);
  return messages;
}
