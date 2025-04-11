import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelChatMessage,
  LanguageModelChatTool,
  LanguageModelTool,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { getExtensionContext } from "../../context/extension";
import { LanguageModelToolContribution } from "./types";

/**
 * Base class for a {@link LanguageModelTool} that adds a {@linkcode toChatTool} method for
 * converting to a {@link LanguageModelChatTool}.
 */
export abstract class BaseLanguageModelTool<T> implements LanguageModelTool<T> {
  abstract readonly name: string;

  abstract invoke(
    options: LanguageModelToolInvocationOptions<T>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult>;

  /**
   * Invokes the tool and processes the result through the {@link ChatResponseStream}.
   * This should be called when the model selects this tool in a {@link LanguageModelToolCallPart}.
   */
  abstract processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<LanguageModelChatMessage[]>;

  /** Converts this tool to a {@link LanguageModelChatTool} for use in chat requests. */
  toChatTool(): LanguageModelChatTool {
    const packageJson = getExtensionContext().extension.packageJSON;
    const registeredTool: LanguageModelToolContribution | undefined =
      packageJson.contributes.languageModelTools!.find(
        (tool: { name: string }) => tool.name === this.name,
      );
    if (!registeredTool) {
      throw new Error(`Tool "${this.name}" not found in package.json`);
    }
    return {
      name: this.name,
      description: registeredTool.modelDescription,
      inputSchema: registeredTool.inputSchema,
    } as LanguageModelChatTool;
  }
}
