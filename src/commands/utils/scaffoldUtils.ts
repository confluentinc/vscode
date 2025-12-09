/** Utilities used by the scaffold commands */
import * as vscode from "vscode";

import { posix } from "path";
import { unzip } from "unzipit";
import { ViewColumn } from "vscode";
import type {
  ApplyScaffoldV1TemplateOperationRequest,
  ResponseError,
  ScaffoldV1Template,
  ScaffoldV1TemplateSpec,
  TemplatesScaffoldV1Api,
} from "../../clients/scaffoldingService";
import { projectScaffoldUri } from "../../emitters";
import { logError } from "../../errors";
import { Logger } from "../../logging";
import { showErrorNotificationWithButtons } from "../../notifications";
import { getTemplatesList, pickTemplate } from "../../projectGeneration/templates";
import { getSidecar } from "../../sidecar";
import { logUsage, UserEvent } from "../../telemetry/events";
import { fileUriExists } from "../../utils/file";
import { WebviewPanelCache } from "../../webview-cache";
import { handleWebviewMessage } from "../../webview/comms/comms";
import type { post, PostResponse } from "../../webview/scaffold-form";
import scaffoldFormTemplate from "../../webview/scaffold-form.html";

const logger = new Logger("scaffoldutils");
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
    const baseMessage: string = await parseErrorDetails(err);
    const stageSpecificMessage = `Project generation failed. Unable to list the templates. ${baseMessage || ""}`;
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

    pickedTemplate = await pickTemplate(templateList);
  } catch (err) {
    logError(err, "template picking", { extra: { functionName: "scaffoldProjectRequest" } });
    const baseMessage = await parseErrorDetails(err);
    const stageSpecificMessage = `Project generation failed. Unable to pick a template. ${baseMessage || ""}`;
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
        let res: PostResponse = { success: false, message: "Failed to apply template." };
        if (pickedTemplate) {
          res = await applyTemplate(pickedTemplate, body.data, telemetrySource);
          // only dispose the form if the template was successfully applied
          if (res.success) optionsForm.dispose();
        } else {
          // This shouldn't happen as pickedTemplate is set earlier, but handle defensively
          const errorMessage = "Failed to apply template. No template selected.";
          void showErrorNotificationWithButtons(errorMessage);
          res = { success: false, message: errorMessage };
        }
        return res satisfies MessageResponse<"Submit">;
      }
    }
  };
  const disposable = handleWebviewMessage(optionsForm.webview, processMessage);
  optionsForm.onDidDispose(() => disposable.dispose());

  return { success: true, message: "Form opened" };
};

// Called on Form Submit
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
    template_collection_name: pickedTemplate.spec!.template_collection!.id,
    name: pickedTemplate.spec!.name!,
    ApplyScaffoldV1TemplateRequest: {
      options: stringifiedOptions,
    },
  };

  // Track which potential failure point/phase we are in so we can surface specific user notifications
  let failureStage: string = "";
  try {
    // Potential failure point 2: calling the apply op in scaffold service.
    failureStage = "scaffold service apply operation";
    const applyTemplateResponse: Blob = await client.applyScaffoldV1Template(request);
    // Potential failure point 3: buffer extraction
    failureStage = "template archive buffering";

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
      logUsage(UserEvent.ProjectScaffoldingAction, {
        status: "cancelled before save",
        templateCollection: pickedTemplate.spec!.template_collection?.id,
        templateId: pickedTemplate.spec!.name,
        templateName: pickedTemplate.spec!.display_name,
        itemType: telemetrySource,
      });
      // Not a failure point - user action. Form remains open and shows X + message at bottom.
      return { success: false, message: "Project generation cancelled before save." };
    }
    // Not a failure point we control - calls vscode internals
    const destination = await getNonConflictingDirPath(fileUris[0], pickedTemplate);
    // Potential failure point 4: extracting the zip contents to the filesystem
    failureStage = "saving extracted template files to disk";

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
      {
        // Do not show a modal dialog when running E2E tests
        modal: !process.env.CONFLUENT_VSCODE_E2E_TESTING,
        detail: `Location: ${destination.path}`,
      },
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
    // Catches failure points 2, 3, and 4 and gives stage-specific notification with details in output channel
    logError(e, "applying template", {
      extra: { templateName: pickedTemplate.spec!.name!, failureStage },
    });
    let message = "Failed to generate template. An unknown error occurred.";
    if (e instanceof Error) {
      const response = (e as ResponseError).response;
      if (response) {
        // Check for 403 Forbidden - likely proxy interference
        if (response.status === 403) {
          message =
            "Access denied. This may be caused by a corporate proxy or VPN blocking the request. Please check your network settings or contact your IT administrator.";
        } else {
          try {
            const payload = await response.json().then((json) => JSON.stringify(json));
            message = parseErrorMessage(payload);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (jsonError) {
            message = `Failed to generate template. Unable to parse error response: ${e}`;
          }
        }
      } else {
        message = e.message;
      }
    }
    const stageSpecificMessage = `Template generation failed while ${failureStage}: ${message}`;
    // Surface user-facing notification with actionable context
    void showErrorNotificationWithButtons(stageSpecificMessage);
    return { success: false, message: stageSpecificMessage };
  }
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

async function extractZipContents(buffer: ArrayBuffer, destination: vscode.Uri) {
  try {
    const { entries } = await unzip(buffer);
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
/**
 * Attempts to extract a useful error message from an unknown error object.
 * Used to provide actionable feedback when a part of the flow fails.
 * @param err - The error object thrown during scaffold operations
 * @returns A string describing the error, or an empty string if not available
 */
async function parseErrorDetails(err: unknown): Promise<string> {
  if (typeof err === "string") {
    return err;
  }

  if (err instanceof Error) {
    // Handle ResponseError with proper type checking
    const responseErr = err as ResponseError;
    if (responseErr.response) {
      const status = responseErr.response.status;

      // Special handling for 403 - likely proxy interference
      if (status === 403) {
        return "Access denied. This may be caused by a corporate proxy or VPN blocking the request. Please check your network settings or contact your IT administrator.";
      }

      try {
        const json = await responseErr.response.json();
        if (json && json.message) {
          return json.message;
        }
        if (json && json.errors && Array.isArray(json.errors)) {
          return json.errors.map((e: any) => e.detail || e.message).join("; ");
        }
        return JSON.stringify(json);
      } catch {
        // If JSON parsing fails, return the error message
        return err.message || "An error occurred but details could not be parsed.";
      }
    }
    return err.message || "";
  }

  if (typeof err === "object" && err !== null) {
    if ("message" in err && typeof (err as any).message === "string") {
      return (err as any).message;
    }
    return JSON.stringify(err);
  }
  return "";
}
