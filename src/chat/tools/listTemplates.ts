import {
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolConfirmationMessages,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  MarkdownString,
  PreparedToolInvocation,
} from "vscode";
import { ScaffoldV1Template } from "../../clients/scaffoldingService";
import { Logger } from "../../logging";
import { getTemplatesList } from "../../scaffold";

const logger = new Logger("chat.tools.listTemplates");

export interface IListTemplatesParameters {
  tags: string[];
}

export class ListTemplatesTool implements LanguageModelTool<IListTemplatesParameters> {
  readonly id = "list_projectTemplates";
  readonly description =
    "List all available templates for creating a streaming application project.";

  async prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<IListTemplatesParameters>,
  ): Promise<PreparedToolInvocation | null | undefined> {
    const confirmationMessage: LanguageModelToolConfirmationMessages = {
      title: "List Templates",
      message: new MarkdownString(
        `You are about to list all available templates for creating a streaming application project.`,
      ),
    };

    return {
      invocationMessage: new MarkdownString(
        `This will list all available templates for creating a streaming application project.`,
      ),
      confirmationMessages: confirmationMessage,
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<IListTemplatesParameters>,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    const templateList = await getTemplatesList();
    logger.debug("templateList:", templateList);

    const templates = Array.from(templateList.data) as ScaffoldV1Template[];
    const templateStrings: LanguageModelTextPart[] = templates.map((template) => {
      const spec = template.spec!;
      return new LanguageModelTextPart(
        `${spec.name} ("${spec.display_name}"): ${spec.description}`,
      );
    });

    return new LanguageModelToolResult(templateStrings);
  }
}
