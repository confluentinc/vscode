import * as vscode from "vscode";
import { Logger } from "../../logging";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.generateProject");

export interface IGenerateProjectParameters {
  cc_bootstrap_server: string;
  cc_topic: string;
}

export class GenerateProjectTool extends BaseLanguageModelTool<IGenerateProjectParameters> {
  readonly name = "project";

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGenerateProjectParameters>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation | null | undefined> {
    logger.debug("prepareInvocation called with options:", options);

    const confirmationMessages = {
      title: "Generate Kafka Client Project",
      message: new vscode.MarkdownString(
        `This will generate a Kafka client project with the following parameters:\n\n` +
          `- **Bootstrap Server**: ${options.input.cc_bootstrap_server || "Not provided"}\n` +
          `- **Topic**: ${options.input.cc_topic || "Not provided"}\n\n` +
          `Do you want to proceed?`,
      ),
    };

    return {
      invocationMessage: confirmationMessages.message,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGenerateProjectParameters>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input;
    logger.debug("GenerateProjectTool invoked with options:", options.input);

    if (!params.cc_bootstrap_server || !params.cc_topic) {
      throw new Error("All parameters (cc_bootstrap_server, cc_topic) are required.");
    }
    // Generate a simple project structure as an EXAMPLE -- this becomes the output and needs to be changed
    const projectStructure = `
      Kafka Client Project:
      - Bootstrap Server: ${params.cc_bootstrap_server}
      - Topic: ${params.cc_topic}
    `;
    logger.debug("Project structure generated:", projectStructure);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Project generated successfully:\n${projectStructure}`),
    ]);
  }

  async processInvocation(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    toolCall: vscode.LanguageModelToolCallPart,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatMessage[]> {
    const parameters = toolCall.input as IGenerateProjectParameters;
    if (!parameters.cc_bootstrap_server || !parameters.cc_topic) {
      return [
        vscode.LanguageModelChatMessage.User(
          "Both `cc_bootstrap_server` and `cc_topic` parameters are required.",
          `${this.name}-error`,
        ),
      ];
    }

    const result: vscode.LanguageModelToolResult = await this.invoke(
      { input: parameters, toolInvocationToken: request.toolInvocationToken },
      token,
    );

    const messages: vscode.LanguageModelChatMessage[] = [];
    if (result.content && Array.isArray(result.content)) {
      let message = `Available project templates:\n`;
      for (const part of result.content as vscode.LanguageModelTextPart[]) {
        message = `${message}\n\n${part.value}`;
      }
      messages.push(vscode.LanguageModelChatMessage.User(message, `${this.name}-result`));
    } else {
      throw new Error(`Unexpected result content structure: ${JSON.stringify(result)}`);
    }
    return messages;
  }
}
