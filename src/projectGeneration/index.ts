import { posix } from "path";
import { unzip } from "unzipit";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ScaffoldV1Template, ScaffoldV1TemplateSpec } from "../clients/scaffoldingService";
import { logError } from "../errors";
import { Logger } from "../logging";
import { showErrorNotificationWithButtons } from "../notifications";
import { UserEvent, logUsage } from "../telemetry/events";
import { fileUriExists } from "../utils/file";
import { WebviewPanelCache } from "../webview-cache";
import { PostResponse, type post } from "../webview/scaffold-form";
import scaffoldFormTemplate from "../webview/scaffold-form.html";
import { getScaffoldingService, getTemplatesList, pickTemplate } from "./template.js";
import { PrefilledTemplateOptions, TemplateOptionValues } from "./types";
import { parseErrorMessage } from "./utils";

type MessageSender = OverloadUnion<typeof post>;

const logger = new Logger("scaffold");
const scaffoldWebviewCache = new WebviewPanelCache();

export const scaffoldProjectRequest = async (
  templateRequestOptions?: PrefilledTemplateOptions,
  telemetrySource?: string,
): Promise<PostResponse> => {
  let pickedTemplate: ScaffoldV1Template | undefined = undefined;
  const templateType = templateRequestOptions?.templateType;
  try {
    let templateList: ScaffoldV1Template[] = await getTemplatesList(
      templateRequestOptions?.templateCollection,
    );
    if (templateRequestOptions && !templateRequestOptions.templateName) {
      templateList = templateList.filter((template) => {
        const tags = template.spec?.tags || [];

        if (templateType === "flink") {
          return tags.includes("apache flink") || tags.includes("table api");
        } else if (templateType === "kafka") {
          return tags.includes("producer") || tags.includes("consumer");
        }

        return tags.includes("producer") || tags.includes("consumer");
      });

      pickedTemplate = await pickTemplate(templateList);
    } else if (templateRequestOptions && templateRequestOptions.templateName) {
      pickedTemplate = templateList.find(
        (template) => template.spec!.name === templateRequestOptions.templateName,
      );
      if (!pickedTemplate) {
        const errMsg =
          "Project template not found. Check the template name and collection and try again.";
        logError(new Error(errMsg), "template not found", {
          extra: {
            templateName: templateRequestOptions.templateName,
            templateCollection: templateRequestOptions.templateCollection,
          },
        });
        showErrorNotificationWithButtons(errMsg);
        return { success: false, message: errMsg };
      }
    } else {
      pickedTemplate = await pickTemplate(templateList);
    }
  } catch (err) {
    logError(err, "template listing", { extra: { functionName: "scaffoldProjectRequest" } });
    vscode.window.showErrorMessage("Failed to retrieve template list");
    return { success: false, message: "Failed to retrieve template list" };
  }

  if (!pickedTemplate) {
    return { success: false, message: "Project generation cancelled." };
  }

  logUsage(UserEvent.ProjectScaffoldingAction, {
    status: "template picked",
    templateCollection: pickedTemplate.spec!.template_collection?.id,
    templateId: pickedTemplate.spec!.name,
    templateName: pickedTemplate.spec!.display_name,
    itemType: telemetrySource,
  });

  const templateSpec: ScaffoldV1TemplateSpec = pickedTemplate.spec!;

  const [optionsForm, wasExisting] = scaffoldWebviewCache.findOrCreate(
    { id: templateSpec.name!, template: scaffoldFormTemplate },
    "template-options-form",
    `Generate ${templateSpec.display_name} Template`,
    ViewColumn.One,
    { enableScripts: true },
  );

  if (wasExisting) {
    optionsForm.reveal();
    return { success: true, message: "Form already open" };
  }

  let optionValues: TemplateOptionValues = {};
  let options = templateSpec.options || {};

  for (const [option, properties] of Object.entries(options)) {
    if (templateRequestOptions && templateRequestOptions[option] !== undefined) {
      let value: string | boolean;
      const optionValue = templateRequestOptions[option];
      if (typeof optionValue === "string") {
        value = optionValue;
      } else {
        value = optionValue === "true";
      }
      optionValues[option] = value;
    } else if (properties.initial_value !== undefined) {
      optionValues[option] = properties.initial_value;
    }
  }

  function updateOptionValue(key: string, value: string) {
    optionValues[key] = value;
  }

  const processMessage = async (message: { type: string; body: any }) => {
    switch (message.type) {
      case "SetOptionValue":
        updateOptionValue(message.body.key, message.body.value);
        break;
      case "Submit":
        try {
          const result = await applyTemplate(pickedTemplate!, message.body.data, telemetrySource);
          return result;
        } catch (err) {
          const errorMessage = parseErrorMessage(err);
          logError(err, "template application", {
            extra: { functionName: "scaffoldProjectRequest" },
          });
          showErrorNotificationWithButtons(errorMessage);
          return { success: false, message: errorMessage };
        }
    }
  };

  optionsForm.webview.onDidReceiveMessage(processMessage);
  optionsForm.webview.postMessage({ type: "initialize", body: { options, optionValues } });
  return { success: true, message: "Form opened" };
};

export async function applyTemplate(
  pickedTemplate: ScaffoldV1Template,
  manifestOptionValues: { [key: string]: unknown },
  telemetrySource?: string,
): Promise<PostResponse> {
  const templatesApi = await getScaffoldingService();
  try {
    const response = await templatesApi.applyScaffoldV1Template({
      template_collection_name: pickedTemplate.spec!.template_collection!.id!,
      name: pickedTemplate.spec!.name!,
      ApplyScaffoldV1TemplateRequest: {
        options: Object.fromEntries(
          Object.entries(manifestOptionValues).map(([key, value]) => [key, String(value)]),
        ),
      },
    });

    const destination = await getNonConflictingDirPath(
      vscode.workspace.workspaceFolders![0].uri,
      pickedTemplate,
    );

    await extractZipContents(await response.arrayBuffer(), destination);

    logUsage(UserEvent.ProjectScaffoldingAction, {
      status: "success",
      templateCollection: pickedTemplate.spec!.template_collection?.id,
      templateId: pickedTemplate.spec!.name,
      templateName: pickedTemplate.spec!.display_name,
      itemType: telemetrySource,
    });

    return { success: true, message: "Project generated successfully" };
  } catch (err) {
    const errorMessage = parseErrorMessage(err);
    logError(err, "template application", { extra: { functionName: "applyTemplate" } });
    showErrorNotificationWithButtons(errorMessage);
    return { success: false, message: errorMessage };
  }
}

async function extractZipContents(buffer: ArrayBuffer, destination: vscode.Uri) {
  const { entries } = await unzip(buffer);
  for (const [path, entry] of Object.entries(entries)) {
    const filePath = posix.join(destination.fsPath, path);
    const fileUri = vscode.Uri.file(filePath);
    const arrayBuffer = await entry.arrayBuffer();
    await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(arrayBuffer));
  }
}

async function getNonConflictingDirPath(
  destination: vscode.Uri,
  pickedTemplate: ScaffoldV1Template,
) {
  let dirName = pickedTemplate.spec!.name!;
  let counter = 1;
  let finalPath = vscode.Uri.joinPath(destination, dirName);

  while (await fileUriExists(finalPath)) {
    dirName = `${pickedTemplate.spec!.name!}-${counter}`;
    finalPath = vscode.Uri.joinPath(destination, dirName);
    counter++;
  }

  await vscode.workspace.fs.createDirectory(finalPath);
  return finalPath;
}

export * from "./commands";
export { getScaffoldingService, getTemplatesList, pickTemplate } from "./template.js";
export * from "./types";
export * from "./utils";
