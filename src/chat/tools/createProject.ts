import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { ScaffoldV1Template } from "../../clients/scaffoldingService";
import { Logger } from "../../logging";
import { getTemplatesList, scaffoldProjectRequest } from "../../scaffold";
import { PostResponse } from "../../webview/scaffold-form";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.getTemplateOptions");

export interface ICreateProjectParameters {
  templateId: string;
  templateOptions: { [key: string]: string | boolean };
}

export class CreateProjectTool extends BaseLanguageModelTool<ICreateProjectParameters> {
  readonly name = "create_project";
  readonly progressMessage = "Setting up project...";

  async invoke(
    options: LanguageModelToolInvocationOptions<ICreateProjectParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    if (!params.templateId || !params.templateOptions) {
      logger.error("No template ID provided");
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Provide a template ID to create a project with it.`),
      ]);
    }

    // TODO: add support for other collections
    const templates: ScaffoldV1Template[] = await getTemplatesList("vscode", true);
    const matchingTemplate: ScaffoldV1Template | undefined = templates.find(
      (template) => template.spec?.name === params.templateId,
    );
    if (!matchingTemplate) {
      logger.error(`No template found with ID: ${params.templateId}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `No template found with ID "${params.templateId}". Run the "list_projectTemplates" tool to get available templates.`,
        ),
      ]);
    }

    // just try to open the form for now
    const resp: PostResponse = await scaffoldProjectRequest({
      templateName: params.templateId,
      ...params.templateOptions,
    });
    if (!resp.success) {
      logger.error(`Error creating project: ${resp.message}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Error creating project: ${resp.message}`),
      ]);
    }

    if (token.isCancellationRequested) {
      logger.info("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult([
      new LanguageModelTextPart(
        `Project created successfully. The user can refer to the form to make any necessary adjustments.`,
      ),
    ]);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as ICreateProjectParameters;

    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );
    if (!result.content.length) {
      // cancellation / no results
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];
    // no header/footer messages needed here
    resultParts.push(...(result.content as LanguageModelTextPart[]));
    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
