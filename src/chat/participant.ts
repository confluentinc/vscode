import * as vscode from "vscode";
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
import { logError } from "../errors";
import { Logger } from "../logging";
import { INITIAL_PROMPT, PARTICIPANT_ID } from "./constants";
import { ModelNotSupportedError } from "./errors";
import { parseReferences } from "./references";
import { GenerateProjectTool, IGenerateProjectParameters } from "./tools/generateProject";
import { IListTemplatesParameters, ListTemplatesTool } from "./tools/listTemplates";
import { getToolMap } from "./tools/toolMap";
const logger = new Logger("chat.participant");

/** Main handler for the Copilot chat participant. */
export async function chatHandler(
  request: ChatRequest & { model?: LanguageModelChat; parameters?: IGenerateProjectParameters },
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

  const toolSelection: vscode.ChatLanguageModelToolReference | null = await compareIntentWithTools(
    request,
    model,
  );

  if ((Array.isArray(request.toolReferences) && request.toolReferences.length) || toolSelection) {
    const toolReference = request.toolReferences.find((ref) => ref.name === "project");

    const toolInvocationToken = request.toolInvocationToken;

    if (toolReference?.name === "project") {
      logger.debug("GenerateProjectTool tool received:", toolReference.name);

      logger.debug("Request object:", request);

      if (!("parameters" in request)) {
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

      if (!parameters.cc_bootstrap_server || !parameters.cc_topic) {
        throw new Error("Missing required parameters: cc_bootstrap_server, cc_topic");
      }
      const tool = new GenerateProjectTool();
      logger.debug("Tool invocation token:", toolInvocationToken);
      logger.debug("Tool reference:", toolReference);
      logger.debug("Tool parameters:", parameters);
      logger.debug("Tool name:", toolReference.name);
      const result = await tool.invoke(
        {
          input: parameters,
          toolInvocationToken,
        },
        token,
      );

      console.log("Tool invocation result:", result);

      if (result.content && Array.isArray(result.content)) {
        console.log("Tool invocation result content:", result.content);

        const markdownContent = result.content
          .map((part) => (part as { value: string }).value || "Unknown content")
          .join("\n");

        stream.markdown(markdownContent);
      } else {
        console.error("Unexpected result content structure:", result.content);
        stream.markdown("Error: Unexpected result content structure.");
      }
      return { metadata: { tool: toolReference.name } };
    } else if (toolSelection?.name === "list_projectTemplates") {
      const tool = new ListTemplatesTool();
      const params = { ...request.parameters } as IListTemplatesParameters;

      stream.progress("Checking with the scaffolding service...");
      const result = await tool.invoke({
        input: params,
        toolInvocationToken,
      });
      if (result.content && Array.isArray(result.content)) {
        messages.push(
          LanguageModelChatMessage.User(
            `Here are the available templates:\n\n${result.content
              .map((part) => (part as { value: string }).value || "Unknown content")
              .join("\n")}`,
            "user",
          ),
        );
      } else {
        stream.markdown("Error: Unexpected result content structure.");
      }
    }
  }

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

/** Compare the intent of the request with available tools and select the appropriate tool. */
async function compareIntentWithTools(
  request: ChatRequest,
  model: LanguageModelChat,
): Promise<vscode.ChatLanguageModelToolReference | null> {
  const toolMap = getToolMap();
  const determineToolPrompt = [
    LanguageModelChatMessage.User(
      `You are a tool selector. Your job is to analyze the user's request and determine which tool to use among the following:\n\n${JSON.stringify(Array.from(toolMap.keys()))}\n\nIf multiple tools are applicable, choose the most relevant one. Analyze this request and respond only with the EXACT name of the tool to use, or "none" if no tool is needed:\n\n"${request.prompt}"`,
    ),
  ];
  logger.debug("Tool selection prompt:", determineToolPrompt);

  const determineToolResponse: LanguageModelChatResponse = await model.sendRequest(
    determineToolPrompt,
    {},
  );
  let selection: string = "";
  for await (const fragment of determineToolResponse.text) {
    selection += fragment;
  }
  logger.debug("Tool selection response:", selection);

  return selection.toLowerCase() !== "none" ? { name: selection } : null;
}
