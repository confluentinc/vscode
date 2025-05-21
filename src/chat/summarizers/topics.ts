import { LanguageModelTextPart } from "vscode";
import { KafkaTopic } from "../../models/topic";

/** Create a string representation of a {@link KafkaTopic} array. */
export function summarizeTopics(topics: KafkaTopic[]): LanguageModelTextPart[] {
  const topicStrings: LanguageModelTextPart[] = [];

  for (const topic of topics) {
    const topicString = new LanguageModelTextPart(`Topic Name: ${topic.name}\n`);
    topicStrings.push(topicString);
  }

  return topicStrings;
}
