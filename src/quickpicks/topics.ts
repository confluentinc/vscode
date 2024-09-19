import { ProgressOptions, ThemeColor, ThemeIcon, window } from "vscode";
import { KafkaTopic } from "../models/topic";
import { getSchemasForTopicEnv, getTopicsForCluster } from "../viewProviders/topics";
import { KafkaCluster } from "../models/kafkaCluster";
import { IconNames } from "../constants";

export async function topicQuickPick(cluster: KafkaCluster): Promise<KafkaTopic | undefined> {
  const options: ProgressOptions = {
    location: { viewId: "confluent-topics" },
    title: "Loading topics...",
  };
  return window.withProgress(options, async () => {
    const topics: KafkaTopic[] = await getTopicsForCluster(cluster, true);
    if (topics.length === 0) {
      window.showInformationMessage("No topics found in the cluster " + cluster.name);
      return;
    }

    const schemas = await getSchemasForTopicEnv(topics[0]);
    const subjectSet = new Set(
      schemas.map((schema) => schema.subject.replace(/-key$|-value$/, "")),
    );

    const choices = topics.map((topic) => ({
      label: topic.name,
      iconPath: subjectSet.has(topic.name)
        ? new ThemeIcon(IconNames.TOPIC)
        : new ThemeIcon(
            IconNames.TOPIC_WITHOUT_SCHEMA,
            new ThemeColor("problemsWarningIcon.foreground"),
          ),
      // reference the topic entity so we can acquire it from the picked object
      topic,
    }));

    const choice = await window.showQuickPick(choices, {
      placeHolder: "Select a topic",
      ignoreFocusOut: true,
    });

    return choice?.topic;
  });
}
