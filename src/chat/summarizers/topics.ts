import { LanguageModelTextPart } from "vscode";
import { KafkaTopic } from "../../models/topic";

/** Create a bullet-point list of {@link KafkaTopic} names. */
export function summarizeTopics(topics: KafkaTopic[]): LanguageModelTextPart[] {
  const topicStrings: LanguageModelTextPart[] = [];

  for (const topic of topics) {
    const topicString = new LanguageModelTextPart(
      `• ${topic.name} with ${topic.children?.map((child) => child.name).join(", ") || "-"}\n`,
    );
    topicStrings.push(topicString);
  }

  return topicStrings;
}
