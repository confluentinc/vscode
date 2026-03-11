import type { ISearchable } from "../resource";
import { ResourceContainer } from "./resourceContainer";

/** Labels for the top-level containers in the Topics view. */
export enum KafkaClusterContainerLabel {
  TOPICS = "Topics",
  CONSUMER_GROUPS = "Consumer Groups",
}

/** A container {@link TreeItem} for resources to display in the Topics view. */
export class KafkaClusterResourceContainer<T extends ISearchable> extends ResourceContainer<T> {
  protected readonly loggerNamePrefix = "KafkaClusterResourceContainer";
}
