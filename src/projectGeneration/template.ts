import * as vscode from "vscode";
import {
  ScaffoldV1Template,
  ScaffoldV1TemplateFromJSON,
  TemplatesScaffoldV1Api,
} from "../clients/scaffoldingService";
import { Configuration } from "../clients/scaffoldingService/runtime";
import { QuickPickItemWithValue } from "../quickpicks/types";
import { getSidecar } from "../sidecar";
import { sanitizeTemplateOptions } from "./utils";

export async function getTemplatesList(
  collection?: string,
  sanitizeOptions: boolean = false,
): Promise<ScaffoldV1Template[]> {
  const templatesApi = await getScaffoldingService();
  const response = await templatesApi.listScaffoldV1Templates({
    template_collection_name: collection || "vscode",
  });
  const templates = Array.from(response.data || []).map(ScaffoldV1TemplateFromJSON);
  return sanitizeOptions ? templates.map(sanitizeTemplateOptions) : templates;
}

export async function pickTemplate(
  templateList: ScaffoldV1Template[],
): Promise<ScaffoldV1Template | undefined> {
  const items: QuickPickItemWithValue<ScaffoldV1Template>[] = templateList.map((template) => ({
    label: template.spec?.display_name || template.spec?.name || "Unknown Template",
    description: template.spec?.description,
    value: template,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a template",
  });

  return selected?.value;
}

export async function getScaffoldingService() {
  const sidecar = await getSidecar();
  const config = new Configuration({
    basePath: sidecar.defaultClientConfigParams.basePath,
    headers: sidecar.defaultClientConfigParams.headers,
  });
  return new TemplatesScaffoldV1Api(config);
}
