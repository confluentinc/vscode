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
import * as vscode from "vscode";
import { logError } from "../errors";
import { Logger } from "../logging";
import { INITIAL_PROMPT, PARTICIPANT_ID } from "./constants";
import { ModelNotSupportedError } from "./errors";
import { parseReferences } from "./references";
import { GenerateProjectTool, IGenerateProjectParameters } from "./tools";
const logger = new Logger("chat.participant");

/** Main handler for the Copilot chat participant. */
export async function chatHandler(
  request: ChatRequest & { model?: LanguageModelChat; parameters?: IGenerateProjectParameters },
  context: ChatContext,
  stream: ChatResponseStream,
  token: CancellationToken,
): Promise<ChatResult> {
  // Check if the request references a tool
  if (request.toolReferences?.length > 0) {
    const toolReference = request.toolReferences[0]; // Assuming a single tool reference
    if (toolReference.name === "generate_clientproject") {
      logger.debug("GenerateProjectTool tool received:", toolReference.name);

      // Debug the request object
      logger.debug("Request object:", request);

      // Extract parameters from the prompt if not already present
      if (!("parameters" in request)) {
        // Prompt the user for missing parameters
        const bootstrapServer = await vscode.window.showInputBox({
          prompt: "Enter the Kafka bootstrap server",
          placeHolder: "e.g., broker.confluent.cloud:9092",
        });

        const topic = await vscode.window.showInputBox({
          prompt: "Enter the Kafka topic name",
          placeHolder: "e.g., my-topic",
        });

        if (!bootstrapServer || !topic) {
          stream.markdown(
            "Error: Both `cc_bootstrap_server` and `cc_topic` are required to generate the project.",
          );
          throw new Error("Both bootstrap server and topic name are required.");
        }

        request.parameters = {
          cc_bootstrap_server: bootstrapServer,
          cc_topic: topic,
        } as IGenerateProjectParameters;
      }

      const parameters = request.parameters as IGenerateProjectParameters;

      // Validate that all required parameters are present
      if (!parameters.cc_bootstrap_server || !parameters.cc_topic) {
        throw new Error("Missing required parameters: cc_bootstrap_server, cc_topic");
      }
      const toolInvocationToken = request.toolInvocationToken;
      const tool = new GenerateProjectTool();
      console.log("Tool invocation token:", toolInvocationToken);
      console.log("Tool reference:", toolReference);
      console.log("Tool parameters:", parameters);
      console.log("Tool name:", toolReference.name);
      const result = await tool.invoke(
        {
          input: parameters,
          toolInvocationToken,
        },
        token,
      );
      // Debug the result object
      console.log("Tool invocation result:", result);

      // Verify the content structure
      if (result.content && Array.isArray(result.content)) {
        console.log("Tool invocation result content:", result.content);

        // Stream the result back to the chat
        const markdownContent = result.content
          .map((part) => (part as { value: string }).value || "Unknown content")
          .join("\n");

        stream.markdown(markdownContent);
      } else {
        console.error("Unexpected result content structure:", result.content);
        stream.markdown("Error: Unexpected result content structure.");
      }
      return { metadata: { tool: toolReference.name } };
    }
  }

  // Handle non-tool requests
  const messages: LanguageModelChatMessage[] = [];

  // Add the initial prompt to the messages
  messages.push(LanguageModelChatMessage.User(INITIAL_PROMPT, "user"));

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

  const model: LanguageModelChat = await getModel({
    vendor: request.model?.vendor,
    family: request.model?.family,
    version: request.model?.version,
    id: request.model?.id,
  });
  logger.debug(`Using model id "${model.id}" for request`);

  if (request.command) {
    // TODO: Implement command handling
    return { metadata: { command: request.command } };
  }

  // Non-command request
  try {
    await handleChatMessage(messages, stream, token, model);
    return {};
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
async function handleChatMessage(
  messages: LanguageModelChatMessage[],
  stream: ChatResponseStream,
  token: CancellationToken,
  model: LanguageModelChat,
): Promise<void> {
  const response: LanguageModelChatResponse = await model.sendRequest(messages, {}, token);

  for await (const fragment of response.text) {
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
