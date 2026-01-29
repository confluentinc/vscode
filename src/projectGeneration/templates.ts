import * as vscode from "vscode";
import { getCCloudAuthSession } from "../authn/utils";
import {
  Configuration,
  TemplatesScaffoldV1Api,
  type ScaffoldV1Template,
  type ScaffoldV1TemplateSpec,
} from "../clients/scaffoldingService";
import type { QuickPickItemWithValue } from "../quickpicks/types";

/**
 * Creates a configured scaffolding API client with OAuth token authentication.
 * @returns A configured TemplatesScaffoldV1Api instance.
 */
export function createScaffoldingApi(): TemplatesScaffoldV1Api {
  const config = new Configuration({
    basePath: "https://api.confluent.cloud",
    accessToken: async () => {
      const session = await getCCloudAuthSession();
      return session?.accessToken ?? "";
    },
  });
  return new TemplatesScaffoldV1Api(config);
}

export function filterSensitiveKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(
        ([key]) => !key.toLowerCase().includes("key") && !key.toLowerCase().includes("secret"),
      )
      .map(([key, value]) => [key, value]),
  );
}

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

/**
 * Fetches available project templates from the scaffolding service.
 *
 * @param collection - The template collection name (default: "vscode")
 * @param sanitizeOptions - Whether to filter sensitive keys from template options
 * @returns Promise resolving to an array of templates
 */
export async function getTemplatesList(
  collection?: string,
  sanitizeOptions: boolean = false,
): Promise<ScaffoldV1Template[]> {
  const api = createScaffoldingApi();
  const response = await api.listScaffoldV1Templates({
    template_collection_name: collection ?? "vscode",
  });

  // Convert the Set to an array and cast to ScaffoldV1Template[]
  // The API returns ScaffoldV1TemplateListDataInner which has the same shape
  const templates = Array.from(response.data) as unknown as ScaffoldV1Template[];

  if (sanitizeOptions) {
    return templates.map(sanitizeTemplateOptions);
  }
  return templates;
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
