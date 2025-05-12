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
import { summarizeProjectTemplate } from "../summarizers/projectTemplate";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

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

    // TODO: add support for other collections
    const templates: ScaffoldV1Template[] = await getTemplatesList("vscode", true);
    const templateStrings: LanguageModelTextPart[] = [];
    templates.forEach((template) => {
      const spec = template.spec!;
      if (inputTagsPassed && !inputTagsMatchSpecTags(params.tags, spec.tags)) {
        // skip any templates that don't match provided tags
        return;
      }
      const templateSummary = summarizeProjectTemplate(template);
      templateStrings.push(new LanguageModelTextPart(templateSummary));
    });

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult(templateStrings);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IListTemplatesParameters;

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
    // no header needed
    resultParts.push(...(result.content as LanguageModelTextPart[]));
    // add a footer to the results
    const resultsFooter = new LanguageModelTextPart(
      `Summarize all of the above project templates for the user. If the user is interested in a specific project template, provide the template's 'ID' with the "get_templateOptions" tool to determine what inputs they need to provide.`,
    );
    resultParts.push(resultsFooter);
    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
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
