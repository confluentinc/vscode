import * as vscode from "vscode";
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
import { applyTemplate, getTemplatesList } from "../../scaffold";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.applyTemplate");

export interface IApplyTemplateParameters {
  templateId: string;
  options: { [key: string]: string };
}

export class ApplyTemplateTool extends BaseLanguageModelTool<IApplyTemplateParameters> {
  readonly name = "apply_projectTemplate";
  readonly progressMessage = "Applying the selected project template...";

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IApplyTemplateParameters>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation | null | undefined> {
    logger.debug("prepareInvocation called with options:", options);

    const confirmationMessages = {
      title: "Apply Project Template",
      message: new vscode.MarkdownString(
        `This will apply the project template with the following parameters:\n\n` +
          `- **Template ID**: ${options.input.templateId || "Not provided"}\n` +
          `- **Options**: ${JSON.stringify(options.input.options, null, 2) || "None"}\n\n` +
          `Do you want to proceed?`,
      ),
    };

    return {
      invocationMessage: confirmationMessages.message,
      confirmationMessages,
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<IApplyTemplateParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    if (!params.templateId) {
      throw new Error("The `templateId` parameter is required.");
    }

    // Fetch the template and apply it
    try {
      const templateList = await getTemplatesList();
      const template = Array.from(templateList.data).find(
        (t) => (t.spec as { name?: string })?.name === params.templateId,
      );

      if (!template) {
        throw new Error(`Template with ID "${params.templateId}" not found.`);
      }

      const result = await applyTemplate(template as ScaffoldV1Template, params.options);

      if (result.success) {
        logger.debug("Template applied successfully:", result.message);
        return new LanguageModelToolResult([
          new LanguageModelTextPart(`Template applied successfully: ${result.message}`),
        ]);
      } else {
        logger.error("Failed to apply template:", result.message);
        return new LanguageModelToolResult([
          new LanguageModelTextPart(`Failed to apply template: ${result.message}`),
        ]);
      }
    } catch (error) {
      logger.error("Error applying template:", error);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Error applying template: ${error}`),
      ]);
    }
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<LanguageModelChatMessage[]> {
    const parameters = toolCall.input as IApplyTemplateParameters;

    if (!parameters.templateId) {
      return [this.toolMessage("The `templateId` parameter is required.", `${this.name}-error`)];
    }

    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    const messages: LanguageModelChatMessage[] = [];
    if (result.content && Array.isArray(result.content)) {
      let message = `Template application result:\n`;
      for (const part of result.content as LanguageModelTextPart[]) {
        message = `${message}\n\n${part.value}`;
      }
      messages.push(this.toolMessage(message, `${this.name}-result`));
    } else {
      throw new Error(`Unexpected result content structure: ${JSON.stringify(result)}`);
    }
    return messages;
  }
}
