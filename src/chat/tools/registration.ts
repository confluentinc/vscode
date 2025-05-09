import { Disposable, lm } from "vscode";
import { BaseLanguageModelTool } from "./base";
import { GetConnectionsTool } from "./getConnections";
import { ListTemplatesTool } from "./listTemplates";
import { setToolMap } from "./toolMap";

export function registerChatTools(): Disposable[] {
  const disposables: Disposable[] = [];

  const tools = new Map<string, BaseLanguageModelTool<any>>([
    ["list_projectTemplates", new ListTemplatesTool()],
    ["get_connections", new GetConnectionsTool()],
  ]);

  for (const [toolId, tool] of tools.entries()) {
    disposables.push(lm.registerTool(toolId, tool));
    setToolMap(toolId, tool);
  }

  return disposables;
}
