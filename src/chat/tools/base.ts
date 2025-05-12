import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelChatTool,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  LanguageModelToolResultPart,
} from "vscode";
import { getExtensionContext } from "../../context/extension";
import { LanguageModelToolContribution } from "./types";

/**
 * Base class for a {@link LanguageModelTool} that adds a {@linkcode toChatTool} method for
 * converting to a {@link LanguageModelChatTool}.
 */
export abstract class BaseLanguageModelTool<T> implements LanguageModelTool<T> {
  abstract readonly name: string;
  /** Message to be shown when this tool is called in a chat session via `stream.progress()`. */
  abstract readonly progressMessage: string;

  abstract invoke(
    options: LanguageModelToolInvocationOptions<T>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult>;

  /**
   * This is a wrapper around {@linkcode invoke} that provides a {@link LanguageModelTool} access to
   * the original request, tool call, and response stream to be used for progress updates and/or
   * interactive outputs.
   * (see https://code.visualstudio.com/api/extension-guides/chat#supported-chat-response-output-types)
   *
   * This is called when the model selects this tool in a {@link LanguageModelToolCallPart}
   * (tool call request).
   */
  abstract processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart>;

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

/**
 * A result from a tool invocation that is intended to be sent back to the model. This is a
 * {@link LanguageModelToolResultPart} where the `content` property is restricted to be an array of
 * {@link LanguageModelTextPart} objects.
 *
 * Since we aren't using `LanguageModelPromptTsxPart`, a tool's `.invoke()` is only ever returning
 * {@link LanguageModelTextPart} instances in its {@link LanguageModelToolResult}, which are then
 * passed directly to the {@link LanguageModelToolResultPart} constructor. That
 * {@link LanguageModelToolResultPart} will then be wrapped as a `User` message before being added
 * to the message history.
 */
export class TextOnlyToolResultPart extends LanguageModelToolResultPart {
  // explicitly restricted to be an array of LanguageModelTextPart
  override content: LanguageModelTextPart[];

  constructor(callId: string, content: LanguageModelTextPart[]) {
    super(callId, content);
    this.content = content;
  }
}
