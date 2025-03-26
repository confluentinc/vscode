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
  LanguageModelChatResponse,
  LanguageModelChatSelector,
  lm,
} from "vscode";
import { Logger } from "../logging";
import { INITIAL_PROMPT, PARTICIPANT_ID } from "./constants";
import { parseReferences } from "./references";

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
  messages.push(LanguageModelChatMessage.User(INITIAL_PROMPT, "user"));

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
    messages.push(LanguageModelChatMessage.User(request.prompt, "user"));
  }

  // add any additional references like `#file:<name>`
  if (request.references.length > 0) {
    const referenceMessages = await parseReferences(request.references);
    logger.debug(`adding ${referenceMessages.length} reference message(s)`);
    messages.push(...referenceMessages);
  }

  try {
    if (request.command) {
      // TODO: implement command handling
      return { metadata: { command: request.command } };
    } else {
      await handleChatMessage(messages, stream, token, request.model);
      return {};
    }
  } catch (error) {
    if (error instanceof Error) {
      logger.error("error handling messages:", error);
      stream.markdown("Error: " + error.message);
      return {
        errorDetails: { message: error.message },
        metadata: { error: true, stack: error.stack, name: error.name },
      };
    }
    throw error;
  }
}

/** Get the language model to use. */
async function getModel(model?: LanguageModelChat): Promise<LanguageModelChat> {
  if (model) {
    // use model provided in the ChatRequest
    return model;
  }

  const modelSelector: LanguageModelChatSelector = { vendor: "copilot", family: "gpt-4o" };
  const models: LanguageModelChat[] = await lm.selectChatModels(modelSelector);
  logger.debug("available chat models:", models);
  if (!models.length) {
    throw new Error(`no language models found for ${JSON.stringify(modelSelector)}`);
  }
  const selectedModel = models[0];
  logger.debug("using language model:", selectedModel);
  return selectedModel;
}

/** Send message(s) and stream the response in markdown format. */
async function handleChatMessage(
  messages: LanguageModelChatMessage[],
  stream: ChatResponseStream,
  token: CancellationToken,
  requestModel?: LanguageModelChat,
): Promise<void> {
  logger.debug("handling chat messages:", messages);

  const model: LanguageModelChat = requestModel ?? (await getModel());
  const chatResponse: LanguageModelChatResponse = await model.sendRequest(messages, {}, token);
  logger.debug("chat response:", chatResponse);

  for await (const fragment of chatResponse.text) {
    if (token.isCancellationRequested) {
      logger.debug("chat request cancelled");
      return;
    }
    stream.markdown(fragment);
  }
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
  logger.debug("filtered history:", filteredHistory);
  if (filteredHistory.length === 0) {
    return [];
  }

  const messages: LanguageModelChatMessage[] = [];
  for (const turn of filteredHistory) {
    // don't re-use previous prompts since the model may misinterpret them as part of the current prompt
    if (turn instanceof ChatRequestTurn) {
      // TODO: check for references/commands used?
      continue;
    }
    if (turn instanceof ChatResponseTurn) {
      // responses from the participant:
      if (turn.response instanceof ChatResponseMarkdownPart) {
        messages.push(LanguageModelChatMessage.User(turn.response.value.value, PARTICIPANT_ID));
      }
    }
  }

  return messages;
}
