import { LanguageModelTool } from "vscode";

const TOOL_MAP = new Map<string, LanguageModelTool<any>>();

export function setToolMap(toolId: string, tool: LanguageModelTool<any>) {
  console.log("here");
  TOOL_MAP.set(toolId, tool);
  console.log("there");
}

export function getToolMap() {
  return TOOL_MAP;
}
