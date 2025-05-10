import { Disposable, lm } from "vscode";
import { BaseLanguageModelTool } from "./base";
import { GetConnectionsTool } from "./getConnections";
import { GetTemplateOptionsTool } from "./getTemplate";
import { ListTemplatesTool } from "./listTemplates";
import { setToolMap } from "./toolMap";

export function registerChatTools(): Disposable[] {
  const tools: BaseLanguageModelTool<any>[] = [
    new ListTemplatesTool(),
    new GetTemplateOptionsTool(),
    new GetConnectionsTool(),
  ];

  const disposables: Disposable[] = [];
  for (const tool of tools) {
    const toolDisposable: Disposable = lm.registerTool(tool.name, tool);
    disposables.push(toolDisposable);
    // also update the registry map for easier lookup later
    setToolMap(tool.name, tool);
  }
  return disposables;
}
