/* eslint-disable @typescript-eslint/no-unused-vars */
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
import { Logger } from "../../logging";
import { scaffoldProjectRequest } from "../../scaffold";
import { logUsage, UserEvent } from "../../telemetry/events";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.applyTemplate");

export interface IApplyTemplateParameters {
  name: string;
  options: { [key: string]: string };
}

/** Parse a LanguageModelTextPart from ListTemplatesTool into IApplyTemplateParameters. */
export function parseListTemplatesOutput(part: LanguageModelTextPart): IApplyTemplateParameters {
  const match = part.value.match(/id="(.+?)"; inputOptions=(\{.*\})/);
  if (!match) {
    throw new Error("Invalid template output format");
  }

  const name = match[1];
  const options = match[2] ? JSON.parse(match[2]) : {};

  return { name, options };
}

export class ApplyTemplateTool extends BaseLanguageModelTool<IApplyTemplateParameters> {
  readonly name = "apply_projectTemplate";
  readonly progressMessage = "Applying the selected project template...";

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IApplyTemplateParameters>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation | null | undefined> {
    try {
      const inputPart = new LanguageModelTextPart(
        `id="${options.input.name}"; inputOptions=${JSON.stringify(options.input.options)}`,
      );
      const parsedParameters = parseListTemplatesOutput(inputPart);

      options.input.options = { ...parsedParameters.options, ...options.input.options };
    } catch (error) {
      logger.error("Error parsing template output:", error);
      throw new Error("Failed to parse template output.");
    }

    const confirmationMessages = {
      title: "Apply Project Template",
      message: new vscode.MarkdownString(
        `This will fill in the project template form with the following parameters:\n\n` +
          `- **Template ID**: ${options.input.name || "Not provided"}\n` +
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
    logger.debug("template application params:", params);
    if (!params.name) {
      throw new Error("The `name` parameter is required.");
    }

    params.options = { ...params.options };
    if (typeof params.options !== "object") {
      logger.debug("Invalid options:", params.options);
      throw new Error("The `options` parameter must be a valid object.");
    }
    const modelUsed =
      (options.toolInvocationToken as { model?: { id: string } } | undefined)?.model?.id ||
      "Unknown Model";
    try {
      const result = await scaffoldProjectRequest({
        templateName: params.name,
        ...params.options,
      });

      if (result !== null) {
        logger.debug("Template application requested successfully:", result);
        logUsage(UserEvent.ToolInvocation, {
          toolName: this.name,
          modelUsed,
          referencesCount: 1,
          success: true,
        });
        return new LanguageModelToolResult([
          new LanguageModelTextPart(`Template application requested successfully: ${result}`),
        ]);
      } else {
        logUsage(UserEvent.ToolInvocation, {
          toolName: this.name,
          modelUsed,
          referencesCount: 1,
          success: true,
        });
        logger.error("Failed to request template application:", result);
        return new LanguageModelToolResult([
          new LanguageModelTextPart(`Failed to request template application: ${result}`),
        ]);
      }
    } catch (error) {
      logger.error("Error requesting template application:", error);
      logUsage(UserEvent.ToolInvocationFailure, {
        toolName: this.name,
        modelUsed,
        referencesCount: 0,
        success: false,
      });
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Error requesting template application: ${error}`),
      ]);
    }
  }
  // private previousMessages = new Set<string>();
  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<LanguageModelChatMessage[]> {
    const parameters = toolCall.input as IApplyTemplateParameters;

    if (!parameters.name) {
      return [this.toolMessage("The `name` parameter is required.", `${this.name}-error`)];
    }
    const message =
      `Let me apply the template with your configuration:\n\n` +
      `🎯 **Template**: \`${parameters.name}\`\n\n` +
      `Options: ${JSON.stringify(parameters.options, null, 2)}`;

    const modelUsed =
      (request.toolInvocationToken as { model?: { id: string } } | undefined)?.model?.id ||
      "Unknown Model";
    try {
      const result = await scaffoldProjectRequest({
        templateName: parameters.name,
        ...parameters.options,
      });
      return [
        this.toolMessage(
          `## Template Request Submitted\n\n` +
            `🎯 **Template**: \`${parameters.name}\`\n\n` +
            `A configuration form will appear in a new window. Please fill in what you can to complete the template creation.\n\n` +
            `> Note: Sensitive information like API keys and secrets will be collected securely through the form.\n\n` +
            `Stop calling the tool and stop sending user messages after invoking the scaffoldProjectRequest function.`,
        ),
      ];
    } catch (error) {
      logger.error("Error requesting template:", error);
      return [this.toolMessage(`❌ Failed to request template: ${error}`, `${this.name}-error`)];
    }
  }
}
