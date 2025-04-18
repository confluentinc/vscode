import * as vscode from "vscode";
import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelChatMessage,
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

  async invoke(
    options: LanguageModelToolInvocationOptions<IApplyTemplateParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);
    logger.debug("options:", options);
    // Ask for user confirmation
    const confirmation = await vscode.window.showQuickPick(["Yes", "No"], {
      placeHolder: `Are you sure you want to apply the template with ID "${params.templateId}"?`,
    });

    if (confirmation !== "Yes") {
      logger.debug("User declined to apply the template.");
      return new LanguageModelToolResult([{ value: "User declined to apply the template." }]);
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
          { value: `Template applied successfully: ${result.message}` },
        ]);
      } else {
        logger.error("Failed to apply template:", result.message);
        return new LanguageModelToolResult([
          { value: `Failed to apply template: ${result.message}` },
        ]);
      }
    } catch (error) {
      logger.error("Error applying template:", error);
      return new LanguageModelToolResult([{ value: `Error applying template: ${error}` }]);
    }
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<LanguageModelChatMessage[]> {
    const parameters = toolCall.input as IApplyTemplateParameters;

    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    return result.content as LanguageModelChatMessage[];
  }
}
