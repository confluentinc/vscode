import { MarkdownString } from "vscode";
import { ScaffoldV1Template } from "../../clients/scaffoldingService";

export function summarizeProjectTemplate(template: ScaffoldV1Template): string {
  let summary = new MarkdownString().appendMarkdown(`- "${template.spec!.name}"`);
  summary.appendCodeblock(JSON.stringify(template.spec!.options, null, 2));

  return summary.value;
}
