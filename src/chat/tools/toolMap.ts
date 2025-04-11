import { LanguageModelTool } from "vscode";

const TOOL_MAP = new Map<string, LanguageModelTool<any>>();

export function setToolMap(toolId: string, tool: LanguageModelTool<any>) {
  TOOL_MAP.set(toolId, tool);
}

export function getToolMap() {
  return TOOL_MAP;
}
