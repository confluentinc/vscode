import { MarkdownString } from "vscode";
import { ScaffoldV1Template, ScaffoldV1TemplateSpec } from "../../clients/scaffoldingService";

export function summarizeProjectTemplate(template: ScaffoldV1Template): string {
  const spec: ScaffoldV1TemplateSpec = template.spec!;
  let summary = new MarkdownString()
    .appendMarkdown(`"${spec.display_name}":`)
    .appendMarkdown(`\n\t- ID: "${spec.name}"`)
    .appendMarkdown(`\n\t- Description: "${spec.description}"`);

  return summary.value;
}

export function summarizeTemplateOptions(template: ScaffoldV1Template): string {
  let summary = new MarkdownString().appendCodeblock(
    JSON.stringify(template.spec!.options, null, 2),
  );
  return summary.value;
}
