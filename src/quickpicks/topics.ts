import { commands, ProgressOptions, ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { ResourceLoader } from "../loaders";
import { KafkaCluster } from "../models/kafkaCluster";
import { KafkaTopic } from "../models/topic";
import { QuickPickItemWithValue } from "./types";

/**
 * Displays a quickpick for selecting a Kafka topic from the given {@link KafkaCluster}. While the
 * quickpick is visible, the Topics view will show a loading indicator.
 *
 * @param cluster - The Kafka cluster to load topics from.
 * @param forceRefresh - Whether to force refresh the topics list.
 * @returns The selected Kafka topic or undefined if no selection was made.
 */
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
    if (!topics.length) {
      window
        .showInformationMessage(
          `No topics found for Kafka cluster "${cluster.name}".`,
          "Create Topic",
        )
        .then((selection) => {
          if (selection === "Create Topic") {
            commands.executeCommand("confluent.topics.create", cluster);
          }
        });
      return;
    }

    const choices: QuickPickItemWithValue<KafkaTopic>[] = topics.map((topic) => {
      return {
        label: topic.name,
        value: topic,
        iconPath: topic.hasSchema
          ? new ThemeIcon(IconNames.TOPIC)
          : new ThemeIcon(IconNames.TOPIC_WITHOUT_SCHEMA),
      };
    });

    const choice: QuickPickItemWithValue<KafkaTopic> | undefined = await window.showQuickPick(
      choices,
      {
        placeHolder: "Select a topic",
        ignoreFocusOut: true,
      },
    );

    return choice?.value;
  });
}
