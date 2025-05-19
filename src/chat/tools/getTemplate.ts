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
import { getTemplatesList } from "../../scaffold";
import { summarizeTemplateOptions } from "../summarizers/projectTemplate";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.getTemplateOptions");

export interface IGetTemplateOptions {
  templateId: string;
}

export class GetTemplateOptionsTool extends BaseLanguageModelTool<IGetTemplateOptions> {
  readonly name = "get_templateOptions";

  private resultCount: number = 0;

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetTemplateOptions>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    if (!params.templateId) {
      logger.error("No template ID provided");
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Provide a template ID to get its options.`),
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
          `No template found with ID "${params.templateId}". Run the "list_projectTemplates" tool to get available templates' IDs.`,
        ),
      ]);
    }

    const templateOptions = matchingTemplate.spec?.options;

    if (templateOptions !== undefined) {
      this.resultCount = Object.keys(templateOptions).length;
    }

    const templateInfo = new LanguageModelTextPart(summarizeTemplateOptions(matchingTemplate));

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
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IGetTemplateOptions;

    stream.progress(`Retrieving template options for templateId: ${parameters.templateId}...`);
    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );
    stream.progress(`Found ${this.resultCount} options for templateId: ${parameters.templateId}.`);
    if (!this.resultCount) {
      // cancellation / no results
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];

    const resultsHeader = new LanguageModelTextPart(
      `Inputs for the ${parameters.templateId} template are listed below:`,
    );
    resultParts.push(resultsHeader);
    resultParts.push(...(result.content as LanguageModelTextPart[]));
    const resultsFooter = new LanguageModelTextPart(
      `If the user wants to continue with this template:
      1. Ask the user to provide values for ALL required inputs listed above
      2. After collecting all user inputs, call the "create_project" tool with:
        - the 'templateId': "${parameters.templateId}"
        - 'templateOptions': an object containing ALL user-provided values
      IMPORTANT: Always include the complete templateOptions object with ALL user input values when calling create_project.`,
    );
    resultParts.push(resultsFooter);
    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
