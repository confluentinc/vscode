import { ProgressOptions, ThemeColor, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { KafkaTopic } from "../models/topic";

const logger = new Logger("quickpicks.topics");

export async function topicQuickPick(
  cluster: KafkaCluster,
  forceRefresh: boolean = false,
): Promise<KafkaTopic | undefined> {
  const options: ProgressOptions = {
    location: { viewId: "confluent-topics" },
    title: "Loading topics...",
  };
  return window.withProgress(options, async () => {
    const loader = ResourceLoader.getInstance(cluster.connectionId);

    const [subjects, topics]: [string[], KafkaTopic[]] = await Promise.all([
      loader.getSubjects(cluster.environmentId!, forceRefresh),
      loader.getTopicsForCluster(cluster, forceRefresh),
    ]);

    logger.debug(
      `Loaded ${subjects.length} subjects and ${topics.length} topics for cluster ${cluster.name}`,
    );

    // Poor person's subject -> topic name mapping, matching only via TopicNameStrategy.
    const subjectSet = new Set(subjects.map((subject) => subject.replace(/-key$|-value$/, "")));

    const choices = topics.map((topic) => {
      const hasSchema = subjectSet.has(topic.name);
      if (hasSchema) {
        // Found a schema for this topic, remove it from the set to speed up future lookups
        subjectSet.delete(topic.name);
      }
      return {
        label: topic.name,
        iconPath: hasSchema
          ? new ThemeIcon(IconNames.TOPIC)
          : new ThemeIcon(
              IconNames.TOPIC_WITHOUT_SCHEMA,
              new ThemeColor("problemsWarningIcon.foreground"),
            ),
        // reference the topic entity so we can acquire it from the picked object
        topic,
      };
    });

    const choice = await window.showQuickPick(choices, {
      placeHolder: "Select a topic",
      ignoreFocusOut: true,
    });

    return choice?.topic;
  });
}
