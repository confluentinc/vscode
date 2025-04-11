import { Disposable, LanguageModelTool, lm } from "vscode";
import { GenerateProjectTool } from "./generateProject";
import { ListTemplatesTool } from "./listTemplates";
import { setToolMap } from "./toolMap";

export function registerChatTools(): Disposable[] {
  const disposables: Disposable[] = [];

  const tools = new Map<string, LanguageModelTool<any>>([
    ["project", new GenerateProjectTool()],
    ["list_projectTemplates", new ListTemplatesTool()],
  ]);

  for (const [toolId, tool] of tools.entries()) {
    disposables.push(lm.registerTool(toolId, tool));
    setToolMap(toolId, tool);
  }

  return disposables;
}
