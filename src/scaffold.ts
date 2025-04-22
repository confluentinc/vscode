import * as vscode from "vscode";

import { posix } from "path";
import { unzip } from "unzipit";
import { ViewColumn } from "vscode";
import {
  ApplyScaffoldV1TemplateOperationRequest,
  ListScaffoldV1TemplatesRequest,
  ScaffoldV1Template,
  ScaffoldV1TemplateList,
  ScaffoldV1TemplateSpec,
  TemplatesScaffoldV1Api,
} from "./clients/scaffoldingService";
import { ResponseError } from "./clients/sidecar";
import { registerCommandWithLogging } from "./commands";
import { projectScaffoldUri } from "./emitters";
import { logError, showErrorNotificationWithButtons } from "./errors";
import { Logger } from "./logging";
import { KafkaCluster } from "./models/kafkaCluster";
import { KafkaTopic } from "./models/topic";
import { QuickPickItemWithValue } from "./quickpicks/types";
import { getSidecar } from "./sidecar";
import { getResourceManager } from "./storage/resourceManager";
import { UserEvent, logUsage } from "./telemetry/events";
import { fileUriExists } from "./utils/file";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { PostResponse, type post } from "./webview/scaffold-form";
import scaffoldFormTemplate from "./webview/scaffold-form.html";
type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

interface PrefilledTemplateOptions {
  templateName?: string;
  [key: string]: string | undefined;
}
const logger = new Logger("scaffold");

const scaffoldWebviewCache = new WebviewPanelCache();
export function registerProjectGenerationCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.scaffold", scaffoldProjectRequest),
    registerCommandWithLogging("confluent.resources.scaffold", resourceScaffoldProjectRequest),
  ];
}

async function resourceScaffoldProjectRequest(item?: KafkaCluster | KafkaTopic) {
  if (item instanceof KafkaCluster) {
    return await scaffoldProjectRequest({
      bootstrap_server: item.bootstrapServers,
      cc_bootstrap_server: item.bootstrapServers,
    });
  } else if (item instanceof KafkaTopic) {
    const cluster = await getResourceManager().getClusterForTopic(item);
    return await scaffoldProjectRequest({
      bootstrap_server: cluster?.bootstrapServers,
      cc_bootstrap_server: cluster?.bootstrapServers,
      cc_topic: item.name,
      topic: item.name,
    });
  }
}

export const scaffoldProjectRequest = async (templateRequestOptions?: PrefilledTemplateOptions) => {
  let pickedTemplate: ScaffoldV1Template | undefined = undefined;
  try {
    const templateListResponse: ScaffoldV1TemplateList = await getTemplatesList();
    let templateList = Array.from(templateListResponse.data) as ScaffoldV1Template[];
    if (templateRequestOptions && !templateRequestOptions.templateName) {
      // When we're triggering the scaffolding from the cluster or topic context menu, we want to show only
      // templates that are tagged as producer or consumer but with a quickpick
      templateList = templateList.filter((template) => {
        const tags = template.spec?.tags || [];
        const hasProducerOrConsumer = tags.includes("producer") || tags.includes("consumer");
        return hasProducerOrConsumer;
      });
      pickedTemplate = await pickTemplate(templateList);
    } else if (templateRequestOptions && templateRequestOptions.templateName) {
      // Handling from a URI where there is a template name matched and quickpick is not needed
      pickedTemplate = templateList.find(
        (template) => template.spec!.name === templateRequestOptions.templateName,
      );
    } else {
      // If no arguments are passed, show all templates
      pickedTemplate = await pickTemplate(templateList);
    }
  } catch (err) {
    logError(err, "template listing", { extra: { functionName: "scaffoldProjectRequest" } });
    vscode.window.showErrorMessage("Failed to retrieve template list");
    return;
  }

  if (!pickedTemplate) {
    // user canceled the quickpick
    return;
  }

  let telemetrySource: string | undefined;
  if (templateRequestOptions?.templateName) {
    // only URIs will specify the templateName
    telemetrySource = "uri";
  } else if (templateRequestOptions?.topic) {
    // no templateName, but we have a topic name so this must've come from a topic tree item
    telemetrySource = "topic";
  } else if (templateRequestOptions?.bootstrap_server) {
    // no templateName, but we have a bootstrap_server (but no topic name) so this must've come from a Kafka cluster tree item
    telemetrySource = "cluster";
  }
  logUsage(UserEvent.ProjectScaffoldingAction, {
    status: "template picked",
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
    return;
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
          templateId: templateSpec.name,
          templateName: templateSpec.display_name,
          itemType: telemetrySource,
        });
        let res: PostResponse = { success: false, message: "Failed to apply template." };
        if (pickedTemplate) {
          res = await applyTemplate(pickedTemplate, body.data, telemetrySource);
          // only dispose the form if the template was successfully applied
          if (res.success) optionsForm.dispose();
        } else vscode.window.showErrorMessage("Failed to apply template.");
        return res satisfies MessageResponse<"Submit">;
      }
    }
  };
  const disposable = handleWebviewMessage(optionsForm.webview, processMessage);
  optionsForm.onDidDispose(() => disposable.dispose());
};

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

async function pickTemplate(
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

export async function getTemplatesList(): Promise<ScaffoldV1TemplateList> {
  // TODO: fetch CCloud templates here once the sidecar supports authenticated template listing

  const client: TemplatesScaffoldV1Api = (await getSidecar()).getTemplatesApi();
  const requestBody: ListScaffoldV1TemplatesRequest = {
    template_collection_name: "vscode",
  };
  return await client.listScaffoldV1Templates(requestBody);
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
        return await scaffoldProjectRequest({ templateName: template, ...options });
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
      if (result.message !== "Project generation canceled before save.") {
        showErrorNotificationWithButtons(
          "Error generating project. Check the template options and try again.",
        );
        logUsage(UserEvent.ProjectScaffoldingAction, {
          status: "URI handling failed",
          templateId: template,
          itemType: "uri",
        });
      }
      // show the form so the user can adjust inputs as needed
      await scaffoldProjectRequest({ templateName: template, ...options });
    } else {
      logUsage(UserEvent.ProjectScaffoldingAction, {
        status: "URI handling succeeded",
        templateId: template,
        itemType: "uri",
      });
    }
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
