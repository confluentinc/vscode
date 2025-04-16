import { IconNames } from "../constants";
import { CustomMarkdownString } from "../models/main";
import { hasCcloudUrl, ICCloudUrlable, IResourceBase } from "../models/resource";

export type KeyValuePair = [string, string | undefined];
export type KeyValuePairArray = KeyValuePair[];

// progress towards https://github.com/confluentinc/vscode/issues/461
export function makeToolTip(
  title: string,
  resource: IResourceBase,
  keyValuePairs: KeyValuePairArray,
) {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### ${title}\n`)
    .appendMarkdown("\n\n---");

  keyValuePairs.forEach(([key, value]) => {
    // Skip undefined values
    if (value === undefined) {
      return;
    }
    tooltip.appendMarkdown(`\n\n${key}: \`${value}\``);
  });

  if (hasCcloudUrl(resource)) {
    tooltip.appendMarkdown("\n\n---");
    const ccloudUrl = (resource as ICCloudUrlable).ccloudUrl;
    tooltip.appendMarkdown(
      `\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudUrl})`,
    );
  }
  return tooltip;
}
