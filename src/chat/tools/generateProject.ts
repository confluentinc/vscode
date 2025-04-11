import * as vscode from "vscode";

export interface IGenerateProjectParameters {
  cc_bootstrap_server: string;
  cc_topic: string;
}

export class GenerateProjectTool implements vscode.LanguageModelTool<IGenerateProjectParameters> {
  readonly id = "project";
  readonly description =
    "Generate a project for a Kafka client. Enter parameters and autogenerate a pre-configured code starter.";

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGenerateProjectParameters>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input;
    console.log("GenerateProjectTool invoked with options:", options.input);

    if (!params.cc_bootstrap_server || !params.cc_topic) {
      throw new Error("All parameters (cc_bootstrap_server, cc_topic) are required.");
    }
    // Generate a simple project structure as an EXAMPLE -- this becomes the output and needs to be changed
    const projectStructure = `
      Kafka Client Project:
      - Bootstrap Server: ${params.cc_bootstrap_server}
      - Topic: ${params.cc_topic}
    `;
    console.log("Project structure generated:", projectStructure);

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Project generated successfully:\n${projectStructure}`),
    ]);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGenerateProjectParameters>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation | null | undefined> {
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
    };
  }
}
