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

const logger = new Logger("chat.tools.listTemplates");

export interface IListTemplatesParameters {
  tags: string[];
}

export class ListTemplatesTool extends BaseLanguageModelTool<IListTemplatesParameters> {
  readonly name = "list_projectTemplates";
  readonly progressMessage = "Checking available project templates...";

  async invoke(
    options: LanguageModelToolInvocationOptions<IListTemplatesParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);
    const inputTagsPassed: boolean = Array.isArray(params.tags) && params.tags.length > 0;
    const modelUsed =
      (options.toolInvocationToken as { model?: { id: string } } | undefined)?.model?.id ||
      "Unknown Model";
    try {
      const templateList = await getTemplatesList(true);
      logger.debug("templateList:", templateList);

      const templates = Array.from(templateList.data) as ScaffoldV1Template[];
      const templateStrings: LanguageModelTextPart[] = [];
      templates.forEach((template) => {
        const spec = template.spec!;
        if (inputTagsPassed && !inputTagsMatchSpecTags(params.tags, spec.tags)) {
          return;
        }
        templateStrings.push(
          new LanguageModelTextPart(
            JSON.stringify({
              id: spec.name,
              inputOptions: spec.options,
              displayName: spec.display_name,
              description: spec.description,
            }),
          ),
        );
      });

      if (token.isCancellationRequested) {
        logger.debug("Tool invocation cancelled");
        return new LanguageModelToolResult([]);
      }

      logUsage(UserEvent.ToolInvocation, {
        toolName: this.name,
        modelUsed,
        referencesCount: templates.length,
        success: true,
      });
      return new LanguageModelToolResult(templateStrings);
    } catch (error) {
      logUsage(UserEvent.ToolInvocationFailure, {
        toolName: this.name,
        modelUsed: modelUsed,
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
    const parameters = toolCall.input as IListTemplatesParameters;

    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    const messages: LanguageModelChatMessage[] = [];
    if (result.content && Array.isArray(result.content)) {
      let message = `Available project templates:\n`;
      for (const part of result.content as LanguageModelTextPart[]) {
        message = `${message}\n\n${part.value}`;
      }
      message = `${message}\n\nUse the display names and descriptions when responding to the user. Use the IDs and inputOptions when creating projects with templates.`;
      messages.push(this.toolMessage(message, "result"));
    } else {
      const errorMessage = `Unexpected result content structure: ${JSON.stringify(result)}`;
      logger.error(errorMessage);
      messages.push(this.toolMessage(errorMessage, "error"));
    }
    return messages;
  }
}

/** Check if `inputTags` match any of the `specTags`, either directly or as a substring. */
export function inputTagsMatchSpecTags(
  inputTags: string[],
  specTags: string[] | undefined,
): boolean {
  if (!(Array.isArray(specTags) && specTags.length)) {
    return false;
  }

  const inputTagsLower = inputTags.map((tag) => tag.toLowerCase());
  const specTagsLower = specTags.map((tag) => tag.toLowerCase());
  // spec tag directly matches an input tag, or input tag is contained within a spec tag
  // (e.g. "flink" in "apache flink")
  return specTagsLower.some((specTag) => {
    for (const tag of inputTagsLower) {
      if (specTag === tag || specTag.includes(tag)) {
        return true;
      }
    }
    return false;
  });
}
