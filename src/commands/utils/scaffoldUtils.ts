/**
 * Utilities used by the scaffold commands
 */
import { posix } from "path";
import { unzip } from "unzipit";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import type { ScaffoldV1Template, ScaffoldV1TemplateSpec } from "../../clients/scaffoldingService";
import { projectScaffoldUri } from "../../emitters";
import { isResponseError, logError } from "../../errors";
import { showErrorNotificationWithButtons } from "../../notifications";
import {
  createScaffoldingApi,
  getTemplatesList,
  pickTemplate,
} from "../../projectGeneration/templates";
import { logUsage, UserEvent } from "../../telemetry/events";
import { fileUriExists } from "../../utils/file";
import { writeFile } from "../../utils/fsWrappers";
import { WebviewPanelCache } from "../../webview-cache";
import { handleWebviewMessage } from "../../webview/comms/comms";
import type { post, PostResponse } from "../../webview/scaffold-form";
import scaffoldFormTemplate from "../../webview/scaffold-form.html";

const scaffoldWebviewCache = new WebviewPanelCache();

export interface PrefilledTemplateOptions {
  templateCollection?: string;
  templateName?: string;
  templateType?: string;
  [key: string]: string | undefined;
}

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

export const scaffoldProjectRequest = async (
  templateRequestOptions?: PrefilledTemplateOptions,
  telemetrySource?: string,
): Promise<PostResponse> => {
  let pickedTemplate: ScaffoldV1Template | undefined = undefined;
  let templateList: ScaffoldV1Template[] | undefined = undefined;
  let { templateType, templateName, templateCollection } = templateRequestOptions || {};

  /** 1. Listing available templates */
  try {
    // undefined templateCollection will default to the "vscode" collection
    templateList = await getTemplatesList(templateCollection);
  } catch (err) {
    logError(err, "template listing", { extra: { functionName: "scaffoldProjectRequest" } });
    const baseMessage: string = await parseErrorMessage(err);
    const stageSpecificMessage = `Project generation failed. Unable to list the templates. ${baseMessage}`;
    void showErrorNotificationWithButtons(stageSpecificMessage);
    return { success: false, message: stageSpecificMessage };
  }

  /** 2. Choosing a template */
  try {
    if (templateName) {
      // ...from a URI where there is a template name passed and showing quickpick is not needed
      pickedTemplate = templateList.find((template) => template.spec!.name === templateName);
      if (!pickedTemplate) {
        // Send the error to Sentry, but don't notify the user.
        // Instead they'll be offered the quickpick to select a different template
        logError(
          new Error("The template name provided in the request was not found."),
          "scaffold project from URI",
          {
            extra: {
              templateName: templateName,
              templateCollection: templateCollection,
            },
          },
        );
      }
    }

    if (templateType) {
      templateList = templateList.filter((template) => {
        const tags = template.spec?.tags || [];
        if (templateType === "flink") {
          return tags.includes("apache flink") || tags.includes("table api");
          // "kafka" type comes from Cluster/Topic context menu
        } else if (templateType === "kafka") {
          return tags.includes("producer") || tags.includes("consumer");
        } else if (templateType === "artifact") {
          return tags.includes("udfs");
        }
        // If an unknown templateType was provided, default to producer/consumer templates???
        return tags.includes("producer") || tags.includes("consumer");
      });
    }
    if (!pickedTemplate) {
      pickedTemplate = await pickTemplate(templateList);
    }
  } catch (err) {
    logError(err, "template picking", { extra: { functionName: "scaffoldProjectRequest" } });
    const baseMessage = await parseErrorMessage(err);
    const stageSpecificMessage = `Project generation failed while selecting a template. ${baseMessage}`;
    void showErrorNotificationWithButtons(stageSpecificMessage);
    return { success: false, message: stageSpecificMessage };
  }

  if (!pickedTemplate) {
    // user canceled the quickpick, exit quietly
    return { success: false, message: "Project generation cancelled." };
  }

  logUsage(UserEvent.ProjectScaffoldingAction, {
    status: "template picked",
    templateCollection: pickedTemplate.spec!.template_collection?.id,
    templateId: pickedTemplate.spec!.name,
    templateName: pickedTemplate.spec!.display_name,
    itemType: telemetrySource,
  });

  /** 3. Setting up & showing the form to gather options from user input */
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

  /** Stores a map of options with key: value pairs that is then updated on form input
   * This keeps a sort of "state" so that users don't lose inputs when the form goes in the background
   * It also initializes the options with either the initial values or known values from the item
   */
  let optionValues: { [key: string]: string | boolean } = {};
  let options = templateSpec.options || {};

  for (const [option, properties] of Object.entries(options)) {
    if (templateRequestOptions && templateRequestOptions[option] !== undefined) {
      let value: string | boolean;
      const optionValue = templateRequestOptions[option];

      // Handle boolean string values
      if (optionValue === "true" || optionValue === "false") {
        value = optionValue === "true";
      } else {
        // Handle regular string values, with undefined check
        value = optionValue || "";
      }
      optionValues[option] = value;
      properties.initial_value = typeof value === "boolean" ? value.toString() : value;
    } else {
      optionValues[option] = properties.initial_value ?? "";
    }
  }

  function updateOptionValue(key: string, value: string) {
    optionValues[key] = value;
  }

  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "GetTemplateSpec": {
        const spec = pickedTemplate?.spec ?? null;
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
      case "Submit": {
        logUsage(UserEvent.ProjectScaffoldingAction, {
          status: "form submitted",
          templateCollection: templateSpec.template_collection?.id,
          templateId: templateSpec.name,
          templateName: templateSpec.display_name,
          itemType: telemetrySource,
        });
        const res: PostResponse = await applyTemplate(pickedTemplate, body.data, telemetrySource);
        // only dispose the form if the template was successfully applied
        if (res.success) optionsForm.dispose();
        return res satisfies MessageResponse<"Submit">;
      }
    }
  };
  const disposable = handleWebviewMessage(optionsForm.webview, processMessage);
  optionsForm.onDidDispose(() => disposable.dispose());

  return { success: true, message: "Form opened" };
};

/**
 * Applies a selected template with the provided option values to generate a project.
 *
 * @param pickedTemplate - The template to apply
 * @param manifestOptionValues - The option values provided by the user
 * @param telemetrySource - Optional source for telemetry tracking
 * @returns A PostResponse indicating success or failure
 */
export async function applyTemplate(
  pickedTemplate: ScaffoldV1Template,
  manifestOptionValues: { [key: string]: unknown },
  telemetrySource?: string,
): Promise<PostResponse> {
  const templateSpec = pickedTemplate.spec;
  if (!templateSpec?.name) {
    return { success: false, message: "Template name is missing" };
  }

  const collectionName = templateSpec.template_collection?.id ?? "vscode";

  // Convert manifestOptionValues to the expected format (string values only)
  const options: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(manifestOptionValues)) {
    options[key] = String(value);
  }

  let zipBlob: Blob;
  try {
    const api = createScaffoldingApi();
    zipBlob = await api.applyScaffoldV1Template({
      template_collection_name: collectionName,
      name: templateSpec.name,
      ApplyScaffoldV1TemplateRequest: {
        options,
      },
    });
  } catch (err) {
    logError(err, "template application", { extra: { functionName: "applyTemplate" } });
    const baseMessage = await parseErrorMessage(err);
    const stageSpecificMessage = `Project generation failed while applying template. ${baseMessage}`;
    void showErrorNotificationWithButtons(stageSpecificMessage);
    return { success: false, message: stageSpecificMessage };
  }

  // Let user select destination folder
  const destinationUri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Save Project",
    title: "Choose destination folder",
  });

  if (!destinationUri || destinationUri.length === 0) {
    return { success: false, message: "Project generation cancelled before save." };
  }

  // Get a non-conflicting directory path
  const destination = await getNonConflictingDirPath(destinationUri[0], pickedTemplate);

  // Extract the zip contents to the destination
  try {
    const buffer = await zipBlob.arrayBuffer();
    await extractZipContents(buffer, destination);
  } catch (err) {
    logError(err, "template extraction", { extra: { functionName: "applyTemplate" } });
    const baseMessage = await parseErrorMessage(err);
    const stageSpecificMessage = `Project generation failed during extraction. ${baseMessage}`;
    void showErrorNotificationWithButtons(stageSpecificMessage);
    return { success: false, message: stageSpecificMessage };
  }

  logUsage(UserEvent.ProjectScaffoldingAction, {
    status: "project saved",
    templateCollection: collectionName,
    templateId: templateSpec.name,
    templateName: templateSpec.display_name,
    itemType: telemetrySource,
  });

  // Offer to open the new project
  const openAction = await vscode.window.showInformationMessage(
    `Project "${templateSpec.display_name}" generated successfully!`,
    "Open Folder",
    "Open in New Window",
  );

  if (openAction === "Open Folder") {
    await vscode.commands.executeCommand("vscode.openFolder", destination, false);
  } else if (openAction === "Open in New Window") {
    await vscode.commands.executeCommand("vscode.openFolder", destination, true);
  }

  return { success: true, message: "Project generated successfully" };
}

/**
 * Extracts a user-friendly error message from various error types.
 * Handles ResponseError, Error objects, strings, and generic objects.
 * @param err - The error to parse
 * @returns A formatted error message suitable for user display
 */
async function parseErrorMessage(err: unknown): Promise<string> {
  // Handle string errors directly
  if (typeof err === "string") {
    return err;
  }

  // Handle ResponseError objects from API calls
  if (isResponseError(err)) {
    if (err.response) {
      const status = err.response.status;

      // Special handling for 403 - likely proxy interference
      if (status === 403) {
        return "Access denied. This may be caused by a corporate proxy or VPN blocking the request. Please check your network settings or contact your IT administrator.";
      }

      try {
        const json = await err.response.json();

        // Handle scaffolding service validation errors with JSON pointer paths
        if (json.errors && Array.isArray(json.errors)) {
          return json.errors
            .map((error: any) => {
              const detail = error.detail || "Unknown error";
              const pointer = error.source?.pointer;
              if (pointer && pointer.startsWith("/options/")) {
                const optionName = pointer.replace("/options/", "");
                return `Invalid format for option '${optionName}': ${detail}`;
              }
              return detail;
            })
            .join("; ");
        }

        // Handle simple message field
        if (json.message) {
          return json.message;
        }

        return JSON.stringify(json);
      } catch {
        // If JSON parsing fails, return a generic message
        return "Unable to parse error response";
      }
    }
  }

  // Handle standard Error objects
  if (err instanceof Error) {
    return err.message || "An unknown error occurred.";
  }

  // Handle generic objects with a message property
  if (typeof err === "object" && err !== null) {
    if ("message" in err && typeof (err as any).message === "string") {
      return (err as any).message;
    }
    return JSON.stringify(err);
  }

  return "An unknown error occurred.";
}

async function extractZipContents(buffer: ArrayBuffer, destination: vscode.Uri) {
  try {
    const { entries } = await unzip(buffer);
    for (const [name, entry] of Object.entries(entries)) {
      const entryBuffer = await entry.arrayBuffer();
      await writeFile(
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
        void showErrorNotificationWithButtons(
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

/** Register a handler for handleProjectScaffoldUriEvent emitter. */
export function setProjectScaffoldListener(): vscode.Disposable {
  return projectScaffoldUri.event(handleProjectScaffoldUriEvent);
}

export async function handleProjectScaffoldUriEvent(uri: vscode.Uri): Promise<void> {
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
  return await handleProjectScaffoldUri(collection, template, isFormNeeded, options);
}
