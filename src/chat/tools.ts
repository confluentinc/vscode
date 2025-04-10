/* eslint-disable @typescript-eslint/no-unused-vars */
import * as vscode from "vscode";
import { getTemplatesList, applyTemplate } from "../scaffold";
import { ScaffoldV1Template } from "../clients/scaffoldingService";

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
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input;
    console.log("GenerateProjectTool invoked with options:", options.input);

    if (!params.cc_bootstrap_server || !params.cc_topic) {
      throw new Error("All parameters (cc_bootstrap_server, cc_topic) are required.");
    }

    // Fetch the list of templates
    const templateList = await this.getTemplateList();
    if (!templateList || templateList.length === 0) {
      throw new Error("No templates available for selection.");
    }

    // Let the user pick a template
    const pickedTemplate = await this.pickTemplate(templateList);
    if (!pickedTemplate) {
      throw new Error("No template selected.");
    }

    console.log("Picked template:", pickedTemplate);

    // Ensure API key and secret are always empty
    const manifestOptionValues = {
      cc_bootstrap_server: params.cc_bootstrap_server,
      cc_topic: params.cc_topic,
      cc_api_key: "", // Always empty
      cc_api_secret: "", // Always empty
    };

    try {
      // Call the applyTemplate function
      const result = await applyTemplate(pickedTemplate, manifestOptionValues);

      if (!result.success) {
        throw new Error(result.message || "An unknown error occurred.");
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`🎉 Project generated successfully:\n${result.message}`),
      ]);
    } catch (error) {
      console.error("Error generating project:", error);
      if (error instanceof Error) {
        throw new Error(`Failed to generate project: ${error.message}`);
      } else {
        throw new Error("Failed to generate project: An unknown error occurred.");
      }
    }
  }

  async getTemplateList(): Promise<ScaffoldV1Template[]> {
    try {
      const templateListResponse = await getTemplatesList();
      return Array.from(templateListResponse.data) as ScaffoldV1Template[];
    } catch (error) {
      console.error("Error fetching template list:", error);
      throw new Error("Failed to retrieve template list.");
    }
  }

  async pickTemplate(templateList: ScaffoldV1Template[]): Promise<ScaffoldV1Template | undefined> {
    const quickPickItems = templateList.map((template) => ({
      label: template.spec?.display_name || "Unnamed Template",
      description: template.spec?.description || "",
      template,
    }));

    const pickedItem = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: "Select a project template",
    });

    return pickedItem?.template;
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
    context.subscriptions.push(vscode.lm.registerTool("project", new GenerateProjectTool()));
    console.log("GenerateProjectTool registered.");
  }
}

export { ChatToolsRegistrar };
