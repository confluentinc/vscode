import { ProgressOptions, ThemeColor, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { ResourceLoader } from "../loaders";
import { KafkaCluster } from "../models/kafkaCluster";
import { KafkaTopic } from "../models/topic";

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

    const topics: KafkaTopic[] = await loader.getTopicsForCluster(cluster, forceRefresh);

    const choices = topics.map((topic) => {
      return {
        label: topic.name,
        iconPath: topic.hasSchema
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
