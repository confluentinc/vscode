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
import { scaffoldProjectRequest } from "../../projectGeneration";
import { PostResponse } from "../../webview/scaffold-form";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";
import { getTemplatesList } from "../../projectGeneration/template";

const logger = new Logger("chat.tools.getTemplateOptions");

export interface ICreateProjectParameters {
  templateId: string;
  templateOptions: { [key: string]: string | boolean };
}

export class CreateProjectTool extends BaseLanguageModelTool<ICreateProjectParameters> {
  readonly name = "create_project";

  async invoke(
    options: LanguageModelToolInvocationOptions<ICreateProjectParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    const templateId = params.templateId;
    if (!templateId) {
      logger.error("No template ID provided");
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Provide a template ID to create a project with it.`),
      ]);
    }

    // NOTE: Copilot has some issues with vague-object models like `templateOptions`, so we have to
    // check if other properties are set that don't match templateId/templateOptions
    let templateOptions: { [key: string]: string | boolean } = params.templateOptions || {};
    if (!Object.keys(templateOptions).length || Object.keys(params).length > 2) {
      const extraOptions = Object.fromEntries(
        Object.entries(params).filter(([key]) => key !== "templateId" && key !== "templateOptions"),
      );
      // merge with any existing templateOptions
      templateOptions = { ...extraOptions, ...templateOptions };
    }

    // For now, we only support this specific template collection.
    const templates: ScaffoldV1Template[] = await getTemplatesList("vscode", true);
    const matchingTemplate: ScaffoldV1Template | undefined = templates.find(
      (template) => template.spec?.name === templateId,
    );
    if (!matchingTemplate) {
      logger.error(`No template found with ID: ${templateId}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `No template found with ID "${templateId}". Run the "list_projectTemplates" tool to get available templates.`,
        ),
      ]);
    }

    // just try to open the form for now
    const resp: PostResponse = await scaffoldProjectRequest(
      {
        templateName: templateId,
        ...templateOptions,
      },
      `copilot:${this.name}`,
    );
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
        `The project template form was successfully opened, and is now ready for the user to verify and/or make any necessary adjustments before the project can be created.`,
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
    stream.progress(
      `Making request to create project with templateId: ${parameters.templateId} and options: ${JSON.stringify(parameters.templateOptions)}...`,
    );

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

    stream.progress(
      `Created project with template name: ${parameters.templateId}. Result: ${result.content
        .map((part) => (part instanceof LanguageModelTextPart ? part.value : ""))
        .join(" ")}.`,
    );
    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];
    // no header/footer messages needed here
    resultParts.push(...(result.content as LanguageModelTextPart[]));
    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
