import * as vscode from "vscode";

import { posix } from "path";
import { unzip } from "unzipit";
import {
  ApplyScaffoldV1TemplateOperationRequest,
  ScaffoldV1Template,
  TemplatesScaffoldV1Api,
} from "./clients/scaffoldingService";
import { ResponseError } from "./clients/sidecar";
import { logError } from "./errors";
import { Logger } from "./logging";
import { QuickPickItemWithValue } from "./quickpicks/types";
import { getSidecar } from "./sidecar";
import { UserEvent, logUsage } from "./telemetry/events";
import { fileUriExists } from "./utils/file";
import { PostResponse } from "./webview/scaffold-form";
const logger = new Logger("scaffold");

export async function applyTemplate(
  pickedTemplate: ScaffoldV1Template,
  manifestOptionValues: { [key: string]: unknown },
  telemetrySource?: string,
): Promise<PostResponse> {
  const client: TemplatesScaffoldV1Api = (await getSidecar()).getTemplatesApi();

  const stringifiedOptions = Object.fromEntries(
    Object.entries(manifestOptionValues).map(([k, v]) => [k, String(v)]),
  );
  const request: ApplyScaffoldV1TemplateOperationRequest = {
    template_collection_name: pickedTemplate.spec!.template_collection!.id!,
    name: pickedTemplate.spec!.name!,
    ApplyScaffoldV1TemplateRequest: {
      options: stringifiedOptions,
    },
  };

  try {
    const applyTemplateResponse: Blob = await client.applyScaffoldV1Template(request);

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
      logUsage(UserEvent.ProjectScaffoldingAction, {
        status: "cancelled before save",
        templateCollection: pickedTemplate.spec!.template_collection?.id,
        templateId: pickedTemplate.spec!.name,
        templateName: pickedTemplate.spec!.display_name,
        itemType: telemetrySource,
      });
      vscode.window.showInformationMessage("Project generation cancelled");
      return { success: false, message: "Project generation cancelled before save." };
    }

    const destination = await getNonConflictingDirPath(fileUris[0], pickedTemplate);

    await extractZipContents(arrayBuffer, destination);
    logUsage(UserEvent.ProjectScaffoldingAction, {
      status: "project generated",
      templateCollection: pickedTemplate.spec!.template_collection?.id,
      templateId: pickedTemplate.spec!.name,
      templateName: pickedTemplate.spec!.display_name,
      itemType: telemetrySource,
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
      logUsage(UserEvent.ProjectScaffoldingAction, {
        status: "project folder opened",
        templateCollection: pickedTemplate.spec!.template_collection?.id,
        templateId: pickedTemplate.spec!.name,
        templateName: pickedTemplate.spec!.display_name,
        keepsExistingWindow,
        itemType: telemetrySource,
      });
      vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(destination.path),
        keepsExistingWindow,
      );
    }
    return { success: true, message: "Project generated successfully." };
  } catch (e) {
    logError(e, "applying template", { extra: { templateName: pickedTemplate.spec!.name! } });
    let message = "Failed to generate template. An unknown error occurred.";
    if (e instanceof Error) {
      message = e.message;
      const response = (e as ResponseError).response;
      if (response) {
        try {
          const payload = await response.json().then((json) => JSON.stringify(json));
          message = parseErrorMessage(payload);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (jsonError) {
          message = `Failed to generate template. Unable to parse error response: ${e}`;
        }
      }
    }
    return { success: false, message };
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

async function getNonConflictingDirPath(
  destination: vscode.Uri,
  pickedTemplate: ScaffoldV1Template,
) {
  let extractZipPath = posix.join(destination.path, `${pickedTemplate.spec!.name}`);

  // Add some random alphanumeric to the end of the folder name to avoid conflicts
  if (await fileUriExists(vscode.Uri.file(extractZipPath))) {
    const randomString = Math.random().toString(36).substring(7);

    extractZipPath = posix.join(destination.path, `${pickedTemplate.spec?.name}-${randomString}`);
  }
  destination = vscode.Uri.file(extractZipPath);
  return destination;
}

export async function pickTemplate(
  templateList: ScaffoldV1Template[],
): Promise<ScaffoldV1Template | undefined> {
  const sortedList = templateList.sort((a, b) => {
    return a.spec!.display_name!.toLowerCase().localeCompare(b.spec!.display_name!.toLowerCase());
  });
  const quickPickItems: QuickPickItemWithValue<ScaffoldV1Template>[] = [];
  sortedList.forEach((templateItem: ScaffoldV1Template) => {
    const spec = templateItem.spec;
    if (!spec) return;

    const tags = spec.tags ? `[${spec.tags.join(", ")}]` : "";
    quickPickItems.push({
      label: spec.display_name!,
      description: tags,
      detail: spec.description!,
      value: templateItem,
    });
  });
  const pickedItem = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: "Select a project template",
  });
  return pickedItem?.value;
}

function parseErrorMessage(rawMessage: string): string {
  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed.errors && Array.isArray(parsed.errors)) {
      return parsed.errors
        .map((error: any) => {
          const detail = error.detail || "Unknown error";
          const pointer = error.source?.pointer || "unknown field";
          const optionName = pointer.replace("/options/", "");
          return `Invalid format for option '${optionName}': ${detail}`;
        })
        .join("\n");
    }
  } catch (e) {
    logger.error("Failed to parse error message:", e);
    return rawMessage;
  }
  return rawMessage;
}
