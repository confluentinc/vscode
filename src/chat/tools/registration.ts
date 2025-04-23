import { logger } from "@sentry/core";
import { Disposable, lm } from "vscode";
import { ApplyTemplateTool } from "./applyTemplateTool";
import { BaseLanguageModelTool } from "./base";
import { GetProjectTemplateTool } from "./getProjectTemplate";
import { ListTemplatesTool } from "./listTemplates";
import { setToolMap } from "./toolMap";

export function registerChatTools(): Disposable[] {
  const disposables: Disposable[] = [];

  const tools = new Map<string, BaseLanguageModelTool<any>>([
    ["list_projectTemplates", new ListTemplatesTool()],
    ["apply_projectTemplate", new ApplyTemplateTool()],
    ["get_projectOptions", new GetProjectTemplateTool()],
  ]);

  logger.debug("Registering chat tools:", tools);

  for (const [toolId, tool] of tools.entries()) {
    disposables.push(lm.registerTool(toolId, tool));
    setToolMap(toolId, tool);
  }

  return disposables;
}
