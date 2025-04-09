import * as vscode from "vscode";

export interface IGenerateProjectParameters {
  cc_bootstrap_server: string;
  cc_api_key: string;
  cc_api_secret: string;
  cc_topic: string;
}

export class GenerateProjectTool implements vscode.LanguageModelTool<IGenerateProjectParameters> {
  readonly id = "generate_clientproject";
  readonly description =
    "Generate a project for a Kafka client. Enter parameters and autogenerate a pre-configured code starter.";

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGenerateProjectParameters>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input;
    console.log("GenerateProjectTool invoked with options:", options.input);

    // Validate required parameters
    if (
      !params.cc_bootstrap_server ||
      !params.cc_api_key ||
      !params.cc_api_secret ||
      !params.cc_topic
    ) {
      throw new Error(
        "All parameters (cc_bootstrap_server, cc_api_key, cc_api_secret, cc_topic) are required.",
      );
    }

    // Generate a simple project structure as an example
    const projectStructure = `
      Kafka Client Project:
      - Bootstrap Server: ${params.cc_bootstrap_server}
      - API Key: ${params.cc_api_key}
      - API Secret: ${params.cc_api_secret}
      - Topic: ${params.cc_topic}
    `;
    console.log("Project structure generated:", projectStructure);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Project generated successfully:\n${projectStructure}`),
    ]);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGenerateProjectParameters>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation | null | undefined> {
    const confirmationMessages = {
      title: "Generate Kafka Client Project",
      message: new vscode.MarkdownString(
        `This will generate a Kafka client project with the following parameters:\n\n` +
          `- **Bootstrap Server**: ${options.input.cc_bootstrap_server || "Not provided"}\n` +
          `- **API Key**: ${options.input.cc_api_key || "Not provided"}\n` +
          `- **API Secret**: ${options.input.cc_api_secret || "Not provided"}\n` +
          `- **Topic**: ${options.input.cc_topic || "Not provided"}\n\n` +
          `Do you want to proceed?`,
      ),
    };

    return {
      invocationMessage: confirmationMessages.message,
    };
  }
}
class ChatToolsRegistrar {
  static registerChatTools(context: vscode.ExtensionContext) {
    console.log("Registering chat tools...");
    context.subscriptions.push(
      vscode.lm.registerTool("generate_clientproject", new GenerateProjectTool()),
    );
    console.log("GenerateProjectTool registered.");
  }
}

export { ChatToolsRegistrar };
