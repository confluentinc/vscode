import type { ThemeIcon } from "vscode";
import type { ISearchable } from "../resource";
import { ResourceContainer } from "./resourceContainer";

/** Labels for the top-level containers in the Topics view. */
export enum KafkaClusterContainerLabel {
  TOPICS = "Topics",
  CONSUMER_GROUPS = "Consumer Groups",
}

/** A container {@link TreeItem} for resources to display in the Topics view. */
export class KafkaClusterResourceContainer<T extends ISearchable> extends ResourceContainer<T> {
  get loggerName() {
    return `models.KafkaClusterResourceContainer(${this.label})`;
  }

  constructor(label: string, children: T[] = [], contextValue?: string, icon?: ThemeIcon) {
    super(label, children, contextValue, icon);

    // convert label to hyphenated id:
    // "Consumer Groups" -> "consumer-groups", "Topics" -> "topics"
    const suffix = label.toLowerCase().replaceAll(/\s+/g, "-");
    this.id = `kafka-cluster-${suffix}`;
  }
}
