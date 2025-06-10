import * as vscode from "vscode";
import { ScaffoldV1Template } from "./clients/scaffoldingService";
import { projectScaffoldUri } from "./emitters";
import { Logger } from "./logging";
import { showErrorNotificationWithButtons } from "./notifications";
import { applyTemplate, getTemplatesList, scaffoldProjectRequest } from "./projectGeneration";
import { registerProjectGenerationCommands as registerProjectGenerationCommandsFromModule } from "./projectGeneration/commands";
import { filterSensitiveKeys, sanitizeTemplateOptions } from "./projectGeneration/utils";
import { UserEvent, logUsage } from "./telemetry/events";
import { WebviewPanelCache } from "./webview-cache";
import { type post } from "./webview/scaffold-form";

type MessageSender = OverloadUnion<typeof post>;

const logger = new Logger("scaffold");

const scaffoldWebviewCache = new WebviewPanelCache();

export const registerProjectGenerationCommands = registerProjectGenerationCommandsFromModule;
export {
  applyTemplate,
  filterSensitiveKeys,
  getTemplatesList,
  sanitizeTemplateOptions,
  scaffoldProjectRequest,
};

export async function handleProjectScaffoldUri(
  collection: string | null,
  template: string | null,
  isFormNeeded: boolean | null,
  options: { [key: string]: string },
): Promise<void> {
  if (!collection || !template) {
    vscode.window.showErrorMessage(
      "Missing required parameters for project generation. Please check the URI.",
    );
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating Project",
      cancellable: true,
    },
    async (progress) => {
      progress.report({ message: "Applying template..." });
      if (isFormNeeded) {
        return await scaffoldProjectRequest(
          {
            templateCollection: collection,
            templateName: template,
            ...options,
          },
          "uri",
        );
      }
      return await applyTemplate(
        {
          spec: {
            name: template,
            template_collection: { id: collection },
            display_name: template,
          },
        } as ScaffoldV1Template,
        options,
        "uri",
      );
    },
  );

  if (result) {
    if (!result.success) {
      if (result.message !== "Project generation cancelled before save.") {
        showErrorNotificationWithButtons(
          "Error generating project. Check the template options and try again.",
        );
        logUsage(UserEvent.ProjectScaffoldingAction, {
          status: "URI handling failed",
          templateCollection: collection,
          templateId: template,
          itemType: "uri",
        });
      }
      // show the form so the user can adjust inputs as needed
      await scaffoldProjectRequest(
        {
          templateCollection: collection,
          templateName: template,
          ...options,
        },
        "uri",
      );
    } else {
      logUsage(UserEvent.ProjectScaffoldingAction, {
        status: "URI handling succeeded",
        templateCollection: collection,
        templateId: template,
        itemType: "uri",
      });
    }
  }
}

export function setProjectScaffoldListener(): vscode.Disposable {
  const disposable = projectScaffoldUri.event(async (uri: vscode.Uri) => {
    // manually parse the URI query since URLSearchParams will attempt to decode it again
    const params = new Map<string, string>();
    if (uri.query) {
      const parts = uri.query.split("&");
      for (const part of parts) {
        const [key, value] = part.split("=");
        if (key && typeof value !== "undefined") {
          params.set(key, value);
        }
      }
    }

    const collection = params.get("collection") ?? null;
    const template = params.get("template") ?? null;
    const isFormNeeded = params.get("isFormNeeded") === "true";

    params.delete("collection");
    params.delete("template");
    const options: { [key: string]: string } = Object.fromEntries(params.entries());
    await handleProjectScaffoldUri(collection, template, isFormNeeded, options);
  });

  return disposable;
}
