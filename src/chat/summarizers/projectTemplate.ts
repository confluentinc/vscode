import { MarkdownString } from "vscode";
import {
  ScaffoldV1Template,
  ScaffoldV1TemplateOption,
  ScaffoldV1TemplateSpec,
} from "../../clients/scaffoldingService";

export function summarizeProjectTemplate(template: ScaffoldV1Template): string {
  const spec: ScaffoldV1TemplateSpec = template.spec!;
  let summary = new MarkdownString()
    .appendMarkdown(`"${spec.display_name}":`)
    .appendMarkdown(`\n\t- ID: "${spec.name}"`)
    .appendMarkdown(`\n\t- Description: "${spec.description}"`);
  return summary.value;
}

export function summarizeTemplateOptions(template: ScaffoldV1Template): string {
  const options: Record<string, ScaffoldV1TemplateOption> | undefined = template.spec!.options;
  if (options === undefined) {
    return "(No options available.)";
  }

  let summary = new MarkdownString().appendCodeblock(JSON.stringify(options, null, 2), "json");
  // iterate through each field and mark it as required if its min_length is greater than 0
  const requiredFields = [];
  for (const [field, properties] of Object.entries(options)) {
    if (properties.min_length && properties.min_length > 0) {
      requiredFields.push(field);
    }
  }
  if (requiredFields.length > 0) {
    summary.appendMarkdown(
      `\n\n**Required fields:** ${requiredFields.map((field) => `\`${field}\``).join(", ")}`,
    );
  }
  return summary.value;
}
