import * as vscode from "vscode";

import { randomBytes } from "crypto";
import { posix } from "path";
import { unzip } from "unzipit";
import { Template, TemplateList, TemplatesApi } from "./clients/sidecar";
import { Logger } from "./logging";
import { getSidecar } from "./sidecar";

import { ExtensionContext, Uri, ViewColumn } from "vscode";
import { registerCommandWithLogging } from "./commands";
import { getTelemetryLogger } from "./telemetry";
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
    scaffoldProjectRequest(context),
  );
  context.subscriptions.push(scaffoldProjectCommand);
};

export const scaffoldProjectRequest = async (context: ExtensionContext) => {
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
    getTelemetryLogger().logUsage("Scaffold Template Picked", {
      templateName: pickedTemplate.spec.display_name,
    });
  } else {
    return;
  }

  const [optionsForm, wasExisting] = scaffoldWebviewCache.findOrCreate(
    pickedTemplate.spec.name,
    "template-options-form",
    `Generate ${pickedTemplate.spec.display_name} Template`,
    ViewColumn.One,
    {
      enableScripts: true,
    },
  );

  if (wasExisting) {
    optionsForm.reveal();
    return;
  }

  const staticRoot = Uri.joinPath(context.extensionUri, "webview");

  optionsForm.webview.html = scaffoldFormTemplate({
    webviewUri: optionsForm.webview.asWebviewUri(Uri.joinPath(staticRoot, "main.js")),
    submitScriptUri: optionsForm.webview.asWebviewUri(Uri.joinPath(staticRoot, "scaffold-form.js")),
    nonce: randomBytes(16).toString("base64"),
  });

  const processMessage = (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "GetTemplateSpec": {
        const spec = pickedTemplate ? pickedTemplate.spec : null;
        return spec satisfies MessageResponse<"GetTemplateSpec">;
      }
      case "Submit":
        getTelemetryLogger().logUsage("Scaffold Form Submitted", {
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
    getTelemetryLogger().logUsage("Scaffold Cancelled", {
      templateName: pickedTemplate.spec.display_name,
    });
    vscode.window.showInformationMessage("Project generation cancelled");
    return;
  }

  const destination = await getNonConflictingDirPath(fileUris[0], pickedTemplate);

  await extractZipContents(arrayBuffer, destination);
  getTelemetryLogger().logUsage("Scaffold Completed", {
    templateName: pickedTemplate.spec.display_name,
  });
  // Notify the user that the project was generated successfully
  const selection = await vscode.window.showInformationMessage(
    `🎉 Generated "${pickedTemplate.spec.display_name}" in ${destination.path}`,
    "Open Folder",
  );
  if (selection === "Open Folder") {
    getTelemetryLogger().logUsage("Scaffold Folder Opened", {
      templateName: pickedTemplate.spec.display_name,
    });
    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(destination.path));
  }
}

async function extractZipContents(buffer: ArrayBuffer, destination: vscode.Uri) {
  try {
    const { entries } = await unzip(buffer);
    // TODO: report progress here while writing files
    for (const [name, entry] of Object.entries(entries)) {
      const entryBuffer = await entry.arrayBuffer();
      vscode.workspace.fs.writeFile(
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
  const quickPickItems: vscode.QuickPickItem[] = templateList.map((templateItem: Template) => {
    const tags = templateItem.spec?.tags ? `[${templateItem.spec.tags.join(", ")}]` : "";
    return {
      label: templateItem.spec.display_name,
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
