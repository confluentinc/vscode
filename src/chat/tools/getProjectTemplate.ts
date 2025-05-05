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
import { logUsage, UserEvent } from "../../telemetry/events";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.getProjectInfo");

export interface IGetTemplateParameter {
  name: string;
}

export class GetProjectTemplateTool extends BaseLanguageModelTool<IGetTemplateParameter> {
  readonly name = "get_projectOptions";
  readonly progressMessage = "Checking available project template options...";

  async invoke(
    options: LanguageModelToolInvocationOptions<
      IGetTemplateParameter & { toolInvocationToken?: { model?: { id: string } } }
    > & { toolInvocationToken?: { model?: { id: string } } | undefined },
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
    try {
      const templateList = await getTemplatesList(true);
      logger.debug("templateList:", templateList);

      const templates = Array.from(templateList.data) as ScaffoldV1Template[];
      const matchingTemplate = templates.find((template) => template.spec?.name === params.name);
      if (!matchingTemplate) {
        logger.error(`No template found with name: ${params.name}`);

        const modelUsed =
          (options.toolInvocationToken as { model?: { id: string } } | undefined)?.model?.id ||
          "Unknown Model";
        logUsage(UserEvent.ToolInvocationFailure, {
          toolName: this.name,
          modelUsed,
          referencesCount: 0,
          success: false,
        });

        return new LanguageModelToolResult([
          new LanguageModelTextPart(
            `No template found with name: "${params.name}", please run list_projectTemplates tool to get available templates.`,
          ),
        ]);
      }

      const templateInfo = new LanguageModelTextPart(
        JSON.stringify(matchingTemplate.spec?.options),
      );

      const modelUsed =
        (options.toolInvocationToken as { model?: { id: string } } | undefined)?.model?.id ||
        "Unknown Model";
      logUsage(UserEvent.ToolInvocation, {
        toolName: this.name,
        modelUsed,
        referencesCount: 1,
        success: true,
      });

      if (token.isCancellationRequested) {
        logger.debug("Tool invocation cancelled");
        logUsage(UserEvent.ToolInvocationCancelled, {
          toolName: this.name,
          modelUsed,
          referencesCount: 1,
          success: true,
        });
        return new LanguageModelToolResult([]);
      }
      return new LanguageModelToolResult([templateInfo]);
    } catch (error) {
      const modelUsed =
        (options.toolInvocationToken as { model?: { id: string } } | undefined)?.model?.id ||
        "Unknown Model";

      logUsage(UserEvent.ToolInvocationFailure, {
        toolName: this.name,
        modelUsed,
        referencesCount: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
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
      let message = `## Template Configuration\n\n`;
      for (const part of result.content as LanguageModelTextPart[]) {
        try {
          const parsed = JSON.parse(part.value);
          message =
            `${message}### Available Options:\n\`\`\`json\n${JSON.stringify(parsed.displayOptions, null, 2)}\n\`\`\`\n\n` +
            `> ${parsed.message}\n\n` +
            `⚠️ Note: Sensitive fields like API keys or secrets have been redacted and will be collected securely through a separate form.\n\n` +
            `To create a project with this template:\n\n` +
            `1. Run: \`apply_projectTemplate\`\n` +
            `2. Enter the template name: \`${parameters.name}\`\n` +
            `3. Stop the tool invocation after running the command.\n`;
        } catch (error) {
          logger.error("Error parsing tool result as JSON:", part.value, error);
          message = `${message}❌ Error parsing tool result: ${part.value}\n\n`;
        }
      }

      messages.push(this.toolMessage(message, "result"));
    } else {
      const errorMessage = `❌ Unexpected result content structure: ${JSON.stringify(result)}`;
      logger.error(errorMessage);
      messages.push(this.toolMessage(errorMessage, "error"));
    }
    return messages;
  }
}
