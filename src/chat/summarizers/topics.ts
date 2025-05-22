import { Subject } from "../../models/schema";
import { KafkaTopic } from "../../models/topic";

/** Create a Markdown-formatted list of {@link KafkaTopic} names and their children as {@link Subject}. */
export function summarizeTopics(topics: KafkaTopic[]): string {
  if (topics.length === 0) {
    return "No topics found.";
  }

  const topicStrings = topics.map((topic) => {
    const subjects: Subject[] = topic.children || [];
    if (subjects.length) {
      const subjectNames = subjects.map((subject) => subject.name).join(", ");
      return `- **${topic.name}** with subjects: ${subjectNames}`;
    } else {
      return `- **${topic.name}**`;
    }
  });

  const associatedSubjects = topics
    .filter((topic) => topic.children && topic.children.length > 0)
    .map((topic) => {
      const subjectNames = topic.children!.map((subject) => subject.name).join(", ");
      return `- **${topic.name}**: ${subjectNames}`;
    });

  const associatedSubjectsSection = associatedSubjects.length
    ? `\n\n### Associated Schema Subject(s)\n${associatedSubjects.join("\n")}`
    : "";

  return `${topicStrings.join("\n")}${associatedSubjectsSection}`;
}
