import * as vscode from "vscode";
import { ScaffoldV1Template, ScaffoldV1TemplateSpec } from "../clients/scaffoldingService";
import { QuickPickItemWithValue } from "../quickpicks/types";
import { filterSensitiveKeys } from "../scaffold";
import { getSidecar } from "../sidecar";

export function sanitizeTemplateOptions(template: ScaffoldV1Template): ScaffoldV1Template {
  const spec = template.spec as ScaffoldV1TemplateSpec;
  const sanitizedOptions = spec?.options ? filterSensitiveKeys(spec.options) : {};

  return {
    ...template,
    spec: {
      ...spec,
      options: sanitizedOptions,
    } as ScaffoldV1TemplateSpec,
  };
}

export async function getTemplatesList(
  collection?: string,
  sanitizeOptions: boolean = false,
): Promise<ScaffoldV1Template[]> {
  const client = (await getSidecar()).getTemplatesApi();
  const response = await client.listScaffoldV1Templates({
    template_collection_name: collection ?? "vscode",
  });

  const templates = Array.from(response.data) as ScaffoldV1Template[];
  return sanitizeOptions ? templates.map(sanitizeTemplateOptions) : templates;
}

export async function pickTemplate(
  templateList: ScaffoldV1Template[],
): Promise<ScaffoldV1Template | undefined> {
  const quickPickItems: QuickPickItemWithValue<ScaffoldV1Template>[] = [];
  templateList.forEach((templateItem: ScaffoldV1Template) => {
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
