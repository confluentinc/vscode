import {
  ChatRequest,
  ChatResponseStream,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolConfirmationMessages,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  MarkdownString,
  PreparedToolInvocation,
} from "vscode";
import { ScaffoldV1Template } from "../../clients/scaffoldingService";
import { Logger } from "../../logging";
import { getTemplatesList } from "../../scaffold";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.listTemplates");

export interface IListTemplatesParameters {
  tags: string[];
}

export class ListTemplatesTool extends BaseLanguageModelTool<IListTemplatesParameters> {
  readonly id = "list_projectTemplates";
  readonly description =
    "List all available templates for creating a streaming application project.";

  async prepareInvocation(): Promise<PreparedToolInvocation | null | undefined> {
    const confirmationMessage: LanguageModelToolConfirmationMessages = {
      title: "List Templates",
      message: new MarkdownString(
        `You are about to list all available templates for creating a streaming application project.`,
      ),
    };

    return {
      invocationMessage: new MarkdownString(
        `This will list all available templates for creating a streaming application project.`,
      ),
      confirmationMessages: confirmationMessage,
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<IListTemplatesParameters>,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    const templateList = await getTemplatesList();
    logger.debug("templateList:", templateList);

    const templates = Array.from(templateList.data) as ScaffoldV1Template[];
    const templateStrings: LanguageModelTextPart[] = templates.map((template) => {
      const spec = template.spec!;
      return new LanguageModelTextPart(
        `${spec.name} ("${spec.display_name}"): ${spec.description}`,
      );
    });

    return new LanguageModelToolResult(templateStrings);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
  ) {
    const parameters = toolCall.input as IListTemplatesParameters;

    stream.progress("Checking with the scaffolding service...");
    const result: LanguageModelToolResult = await this.invoke({
      input: parameters,
      toolInvocationToken: request.toolInvocationToken,
    });
    logger.debug("Processing invocation result:", result);

    if (result.content && Array.isArray(result.content)) {
      const templateMessage: string = `Here are the available templates:\n\n${result.content
        .map((part) => (part as { value: string }).value || "Unknown content")
        .join("\n")}`;
      stream.markdown(templateMessage);
    } else {
      stream.markdown("Error: Unexpected result content structure.");
    }
  }
}
