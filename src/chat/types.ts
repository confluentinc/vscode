import type { ChatResult } from "vscode";
import type { ToolCallMetadata } from "./tools/types";

/** Extension of {@link ChatResult} to set specific keys and types for `metadata`. */
export interface CustomChatResult extends ChatResult {
  metadata?: {
    modelInfo: Record<string, any>;
    toolsCalled?: ToolCallMetadata[];
  };
}
