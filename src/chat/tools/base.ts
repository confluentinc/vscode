import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelChatTool,
  LanguageModelTool,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  PreparedToolInvocation,
} from "vscode";
import { getExtensionContext } from "../../context/extension";
import { LanguageModelToolContribution } from "./types";

/**
 * Base class for a {@link LanguageModelTool} that adds a {@linkcode toChatTool} method for
 * converting to a {@link LanguageModelChatTool}.
 */
export abstract class BaseLanguageModelTool<T> implements LanguageModelTool<T> {
  abstract readonly id: string;
  abstract readonly description: string;

  // these two methods are required as part of the`LanguageModelTool` interface
  abstract prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<T>,
    token: CancellationToken,
  ): Promise<PreparedToolInvocation | null | undefined>;

  abstract invoke(
    options: LanguageModelToolInvocationOptions<T>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult>;

  /**
   * Invokes the tool and processes the result through the {@link ChatResponseStream}.
   * This should be called when the model selects this tool in a {@link LanguageModelToolCallPart}.
   */
  abstract processInvocation<R>(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<R | undefined | void>;

  /** Converts this tool to a {@link LanguageModelChatTool} for use in chat requests. */
  toChatTool(): LanguageModelChatTool {
    const packageJson = getExtensionContext().extension.packageJSON;
    const registeredTool: LanguageModelToolContribution | undefined =
      packageJson.contributes.languageModelTools!.find(
        (tool: { name: string }) => tool.name === this.id,
      );
    if (!registeredTool) {
      throw new Error(`Tool "${this.id}" not found in package.json`);
    }
    return {
      name: this.id,
      description: this.description,
      inputSchema: registeredTool.inputSchema,
    } as LanguageModelChatTool;
  }
}
