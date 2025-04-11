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
import { parseReferences } from "./references";
import { BaseLanguageModelTool } from "./tools/base";
import { GenerateProjectTool } from "./tools/generateProject";
import { ListTemplatesTool } from "./tools/listTemplates";
import { getToolMap } from "./tools/toolMap";
const logger = new Logger("chat.participant");

/** Main handler for the Copilot chat participant. */
export async function chatHandler(
  request: ChatRequest,
  context: ChatContext,
  stream: ChatResponseStream,
  token: CancellationToken,
): Promise<ChatResult> {
  const messages: LanguageModelChatMessage[] = [];
  // Add the initial prompt to the messages
  messages.push(LanguageModelChatMessage.User(INITIAL_PROMPT, "user"));

  const model: LanguageModelChat = await getModel({
    vendor: request.model?.vendor,
    family: request.model?.family,
    version: request.model?.version,
    id: request.model?.id,
  });
  logger.debug(`Using model id "${model.id}" for request`);

  const userPrompt = request.prompt.trim();
  // Check for empty request
  if (userPrompt === "" && request.references.length === 0 && request.command === undefined) {
    stream.markdown("Hmm... I don't know how to respond to that.");
    return {};
  }

  // Add historical messages to the context, along with the user prompt if provided
  const historyMessages = filterContextHistory(context.history);
  messages.push(...historyMessages);
  if (userPrompt) {
    messages.push(LanguageModelChatMessage.User(request.prompt, "user"));
  }

  // Add any additional references like `#file:<name>`
  if (request.references.length > 0) {
    const referenceMessages = await parseReferences(request.references);
    logger.debug(`Adding ${referenceMessages.length} reference message(s)`);
    messages.push(...referenceMessages);
  }

  if (request.command) {
    // TODO: Implement command handling
    return { metadata: { command: request.command } };
  }

  const requestOptions: LanguageModelChatRequestOptions = {
    // inform the model that tools can be invoked as part of the response stream
    tools: [new GenerateProjectTool().toChatTool(), new ListTemplatesTool().toChatTool()],
    toolMode: LanguageModelChatToolMode.Auto,
  };

  const toolsCalled: string[] = [];
  // Non-command request
  try {
    const response: LanguageModelChatResponse = await model.sendRequest(
      messages,
      requestOptions,
      token,
    );
    for await (const fragment of response.stream) {
      if (token.isCancellationRequested) {
        logger.debug("chat request cancelled");
        return {};
      }
      if (fragment instanceof LanguageModelToolCallPart) {
        // tool call
        logger.debug("Tool call fragment:", fragment);
        const tool: BaseLanguageModelTool<any> | undefined = getToolMap().get(fragment.name);
        if (!tool) {
          const errorMsg = `Tool "${fragment.name}" not found.`;
          logger.error(errorMsg);
          stream.markdown(errorMsg);
          return {};
        }
        // each registered tool should contribute its own way of handling the invocation and
        // interacting with the stream
        logger.debug(`Processing tool invocation for "${fragment.name}"`);
        try {
          await tool.processInvocation(request, stream, fragment, token);
          toolsCalled.push(fragment.name);
        } catch (error) {
          logger.error(`Error processing tool invocation for "${fragment.name}":`, error);
          stream.markdown(`Error processing tool invocation: ${error}`);
        }
      } else if (fragment instanceof LanguageModelTextPart) {
        // basic text response
        stream.markdown(fragment.value);
      }
    }
    return { metadata: { toolsCalled } };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("model_not_supported")) {
        const errMsg = `The "${model.name}" model is not currently supported. Please choose a different model from the dropdown and try again.`;
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
      logError(error, "chatHandler", { model: model?.name ?? "unknown" });
      return {
        errorDetails: { message: error.message },
        metadata: { error: true, stack: error.stack, name: error.name },
      };
    }
    // re-throw any errors that aren't "model not supported"-related
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
      if (turn.participant === PARTICIPANT_ID) {
        messages.push(LanguageModelChatMessage.User(turn.prompt));
      }
      continue;
    }
    if (turn instanceof ChatResponseTurn) {
      // responses from the participant:
      if (turn.response instanceof ChatResponseMarkdownPart) {
        messages.push(
          LanguageModelChatMessage.Assistant(turn.response.value.value, PARTICIPANT_ID),
        );
      }
    }
  }

  return messages;
}
