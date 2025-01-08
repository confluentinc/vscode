import * as Sentry from "@sentry/node";
import * as vscode from "vscode";

import { posix } from "path";
import { unzip } from "unzipit";
import { Template, TemplateList, ScaffoldV1TemplateSpec, TemplatesApi } from "./clients/sidecar";
import { Logger } from "./logging";
import { getSidecar } from "./sidecar";

import { ExtensionContext, ViewColumn } from "vscode";
import { registerCommandWithLogging } from "./commands";
import { UserEvent, logUsage } from "./telemetry/events";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { type post } from "./webview/scaffold-form";
import scaffoldFormTemplate from "./webview/scaffold-form.html";
type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

const logger = new Logger("scaffold");
const scaffoldWebviewCache = new WebviewPanelCache();

export const registerProjectGenerationCommand = (context: ExtensionContext) => {
  const scaffoldProjectCommand = registerCommandWithLogging("confluent.scaffold", () =>
    scaffoldProjectRequest(),
  );
  context.subscriptions.push(scaffoldProjectCommand);
};

export const scaffoldProjectRequest = async () => {
  let pickedTemplate: Template | undefined = undefined;
  try {
    const templateListResponse: TemplateList = await getTemplatesList();
    const templateList = templateListResponse.data;
    const pickedItem = await pickTemplate(templateList);
    pickedTemplate = templateList.find(
      (template) => template.spec.display_name === pickedItem?.label,
    );
  } catch (err) {
    logger.error("Failed to retrieve template list", err);
    vscode.window.showErrorMessage("Failed to retrieve template list");
    return;
  }

  if (pickedTemplate !== undefined) {
    logUsage(UserEvent.ScaffoldTemplatePicked, {
      templateName: pickedTemplate.spec.display_name,
    });
  } else {
    return;
  }

  const [optionsForm, wasExisting] = scaffoldWebviewCache.findOrCreate(
    { id: pickedTemplate.spec.name as string, template: scaffoldFormTemplate },
    "template-options-form",
    `Generate ${pickedTemplate.spec.display_name} Template`,
    ViewColumn.One,
    { enableScripts: true },
  );

  if (wasExisting) {
    optionsForm.reveal();
    return;
  }

  /** Stores a map of options with key: value pairs that is then updated on form input
   * This keeps a sort of "state" so that users don't lose inputs when the form goes in the background
   */
  let optionValues: { [key: string]: string | boolean } = {};
  let options = (pickedTemplate.spec.options as ScaffoldV1TemplateSpec["options"]) || {};
  Object.entries(options).map(([option, properties]) => {
    optionValues[option] = properties.initial_value ?? "";
  });
  function updateOptionValue(key: string, value: string) {
    optionValues[key] = value;
  }
  const processMessage = (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "GetTemplateSpec": {
        const spec = pickedTemplate ? pickedTemplate.spec : null;
        return spec satisfies MessageResponse<"GetTemplateSpec">;
      }
      case "GetOptionValues": {
        return optionValues satisfies MessageResponse<"GetOptionValues">;
      }
      case "SetOptionValue": {
        const { key, value } = body;
        updateOptionValue(key, value);
        return null satisfies MessageResponse<"SetOptionValue">;
      }
      case "Submit":
        logUsage(UserEvent.ScaffoldFormSubmitted, {
          templateName: pickedTemplate?.spec.display_name,
        });
        if (pickedTemplate) applyTemplate(pickedTemplate, body.data);
        optionsForm.dispose();
        return null satisfies MessageResponse<"Submit">;
    }
  };
  const disposable = handleWebviewMessage(optionsForm.webview, processMessage);
  optionsForm.onDidDispose(() => disposable.dispose());
};

async function applyTemplate(
  pickedTemplate: Template,
  manifestOptionValues: { [key: string]: unknown },
) {
  try {
    const client: TemplatesApi = (await getSidecar()).getTemplatesApi();
    const applyTemplateResponse: Blob = await client.gatewayV1TemplatesNameApplyPost({
      name: pickedTemplate.id,
      ApplyTemplateRequest: {
        options: manifestOptionValues,
      },
    });

    const arrayBuffer = await applyTemplateResponse.arrayBuffer();

    const SAVE_LABEL = "Save to directory";
    const fileUris = await vscode.window.showOpenDialog({
      openLabel: SAVE_LABEL,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      // Parameter might be ignored on some OSes (e.g. macOS)
      title: SAVE_LABEL,
    });

    if (!fileUris || fileUris.length !== 1) {
      // This means the user cancelled @ save dialog. Show a message and return
      logUsage(UserEvent.ScaffoldCancelled, {
        templateName: pickedTemplate.spec.display_name,
      });
      vscode.window.showInformationMessage("Project generation cancelled");
      return;
    }

    const destination = await getNonConflictingDirPath(fileUris[0], pickedTemplate);

    await extractZipContents(arrayBuffer, destination);
    logUsage(UserEvent.ScaffoldCompleted, {
      templateName: pickedTemplate.spec.display_name,
    });
    // Notify the user that the project was generated successfully
    const selection = await vscode.window.showInformationMessage(
      `🎉 Project Generated`,
      { modal: true, detail: `Location: ${destination.path}` },
      { title: "Open in New Window" },
      { title: "Open in Current Window" },
      { title: "Dismiss", isCloseAffordance: true },
    );
    if (selection !== undefined && selection.title !== "Dismiss") {
      // if "true" is set in the `vscode.openFolder` command, it will open a new window instead of
      // reusing the current one
      const keepsExistingWindow = selection.title === "Open in New Window";
      logUsage(UserEvent.ScaffoldFolderOpened, {
        templateName: pickedTemplate.spec.display_name,
        keepsExistingWindow,
      });
      vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(destination.path),
        keepsExistingWindow,
      );
    }
  } catch (e) {
    logger.error("Failed to apply template", e);
    Sentry.captureException(e);
    const action = await vscode.window.showErrorMessage(
      "There was an error while generating the project. Try again or file an issue.",
      { title: "Try again" },
      { title: "Report an issue" },
    );
    if (action !== undefined) {
      const cmd = action.title === "Try again" ? "confluent.scaffold" : "confluent.support.issue";
      await vscode.commands.executeCommand(cmd);
    }
    return;
  }
}

async function extractZipContents(buffer: ArrayBuffer, destination: vscode.Uri) {
  try {
    const { entries } = await unzip(buffer);
    // TODO: report progress here while writing files
    for (const [name, entry] of Object.entries(entries)) {
      const entryBuffer = await entry.arrayBuffer();
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(posix.join(destination.path, name)),
        new Uint8Array(entryBuffer),
      );
    }
  } catch (err) {
    throw new Error(`Failed to extract zip contents: ${err}`);
  }
}

async function getNonConflictingDirPath(destination: vscode.Uri, pickedTemplate: Template) {
  let extractZipPath = posix.join(destination.path, `${pickedTemplate.id}`);

  // Add some random alphanumeric to the end of the folder name to avoid conflicts
  if (await pathExists(extractZipPath)) {
    const randomString = Math.random().toString(36).substring(7);

    extractZipPath = posix.join(destination.path, `${pickedTemplate.id}-${randomString}`);
  }
  destination = vscode.Uri.file(extractZipPath);
  return destination;
}

async function pathExists(path: string) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return true;
  } catch {
    return false;
  }
}

async function pickTemplate(templateList: Template[]): Promise<vscode.QuickPickItem | undefined> {
  const sortedList = templateList.sort((a, b) => {
    return (a.spec.display_name as string)
      .toLowerCase()
      .localeCompare((b.spec.display_name as string).toLowerCase());
  });
  const quickPickItems: vscode.QuickPickItem[] = sortedList.map((templateItem: Template) => {
    const tags = templateItem.spec?.tags ? `[${templateItem.spec.tags.join(", ")}]` : "";
    return {
      label: templateItem.spec.display_name as string,
      description: tags,
      detail: templateItem.spec.description,
    };
  });
  return await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: "Select a project template",
  });
}

async function getTemplatesList(): Promise<TemplateList> {
  const client: TemplatesApi = (await getSidecar()).getTemplatesApi();
  return await client.gatewayV1TemplatesGet();
}
