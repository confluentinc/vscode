import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { ScaffoldV1Template } from "../../clients/scaffoldingService";
import { Logger } from "../../logging";
import { getTemplatesList } from "../../scaffold";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.getProjectInfo");

export interface IGetTemplateParameter {
  name: string;
}

export class GetProjectTemplateTool extends BaseLanguageModelTool<IGetTemplateParameter> {
  readonly name = "get_projectOptions";
  readonly progressMessage = "Checking available project template options...";

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetTemplateParameter>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    if (!params.name) {
      logger.error("No template name provided");
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Please provide a template name to get its options.`),
      ]);
    }

    const templateList = await getTemplatesList();
    logger.debug("templateList:", templateList);

    const templates = Array.from(templateList.data) as ScaffoldV1Template[];
    const matchingTemplate = templates.find((template) => template.spec?.name === params.name);
    if (!matchingTemplate) {
      logger.error(`No template found with name: ${params.name}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `No template found with name: "${params.name}", please run list_projectTemplates tool to get available templates.`,
        ),
      ]);
    }

    const templateInfo = new LanguageModelTextPart(JSON.stringify(matchingTemplate.spec?.options));

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult([templateInfo]);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<LanguageModelChatMessage[]> {
    const parameters = toolCall.input as IGetTemplateParameter;

    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    const messages: LanguageModelChatMessage[] = [];
    if (result.content && Array.isArray(result.content)) {
      let message = `Project options inputs:\n`;
      for (const part of result.content as LanguageModelTextPart[]) {
        message = `${message}\n\n${part.value}`;
      }
      message = `${message}\n\nPlease use the above options to create a project template.`;
      messages.push(this.toolMessage(message, "result"));
    } else {
      const errorMessage = `Unexpected result content structure: ${JSON.stringify(result)}`;
      logger.error(errorMessage);
      messages.push(this.toolMessage(errorMessage, "error"));
    }
    return messages;
  }
}
