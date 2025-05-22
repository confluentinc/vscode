import { Subject } from "../../models/schema";
import { KafkaTopic } from "../../models/topic";

/** Create a Markdown-formatted list of {@link KafkaTopic} names and their children as {@link Subject}. */
export function summarizeTopics(topic: KafkaTopic): string {
  const subjects: Subject[] = topic.children || [];
  if (subjects.length) {
    const subjectNames = subjects.map((subject) => subject.name).join(", ");
    const subjectLabel = subjects.length > 1 ? "Schema Subjects" : "Schema Subject";
    return (
      `- ## ${topic.name}\n` +
      `### Internal: ${topic.is_internal}\n` +
      `### Associated ${subjectLabel}\n${subjectNames}`
    );
  } else {
    return `- ## ${topic.name}\n` + `### Internal: ${topic.is_internal}\n`;
  }
}
