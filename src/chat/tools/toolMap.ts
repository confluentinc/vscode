import { BaseLanguageModelTool } from "./base";

const TOOL_MAP = new Map<string, BaseLanguageModelTool<any>>();

export function setToolMap(toolId: string, tool: BaseLanguageModelTool<any>) {
  TOOL_MAP.set(toolId, tool);
}

export function getToolMap() {
  return TOOL_MAP;
}
