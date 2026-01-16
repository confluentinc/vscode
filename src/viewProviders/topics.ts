import type { Disposable, TreeItem } from "vscode";
import { window } from "vscode";
import { ContextValues } from "../context/values";
import type {
  EnvironmentChangeEvent,
  SchemaVersionChangeEvent,
  SubjectChangeEvent,
} from "../emitters";
import {
  environmentChanged,
  localKafkaConnected,
  schemaSubjectChanged,
  schemaVersionsChanged,
  topicSearchSet,
  topicsViewResourceChanged,
} from "../emitters";
import { ResourceLoader } from "../loaders";
import { TopicFetchError } from "../loaders/utils/loaderUtils";
import { KafkaCluster } from "../models/kafkaCluster";
import { isCCloud, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { ParentedBaseViewProvider } from "./baseModels/parentedBase";

/**
 * The types managed by the {@link TopicViewProvider}, which are converted to their appropriate tree item
 * type via the {@link TopicViewProvider provider's} {@linkcode TopicViewProvider.getTreeItem() .getTreeItem()} method.
 */
type TopicViewProviderData = KafkaTopic | Subject | Schema;

/**
 * Provider for the "Topics" view resources.
 * Shows topics for the focused Kafka cluster, any associated subjects, and schema versions.
 */
export class TopicViewProvider extends ParentedBaseViewProvider<
  KafkaCluster,
  TopicViewProviderData
> {
  readonly viewId = "confluent-topics";
  readonly kind = "topics";
  loggerName = "viewProviders.topics";

  parentResourceChangedEmitter = topicsViewResourceChanged;
  parentResourceChangedContextValue = ContextValues.kafkaClusterSelected;

  searchContextValue = ContextValues.topicSearchApplied;
  searchChangedEmitter = topicSearchSet;

  /** Map of topic name -> {@link KafkaTopic} instance currently in the tree view. */
  private topicsInTreeView: Map<string, KafkaTopic> = new Map();
  /** Map of subject name -> {@link Subject} instance currently in the tree view. */
  private subjectsInTreeView: Map<string, Subject> = new Map();
  /** Map of subject name -> parent {@link KafkaTopic} for easy parent lookup. */
  private subjectToTopicMap: Map<string, KafkaTopic> = new Map();

  private clearCaches(): void {
    this.topicsInTreeView.clear();
    this.subjectsInTreeView.clear();
    this.subjectToTopicMap.clear();
  }

  get kafkaCluster(): KafkaCluster | null {
    return this.resource;
  }

  set kafkaCluster(cluster: KafkaCluster | null) {
    this.resource = cluster;
  }

  getChildren(element?: TopicViewProviderData): TopicViewProviderData[] {
    if (!this.kafkaCluster) {
      return [];
    }

    let children: TopicViewProviderData[] = [];

    if (!element) {
      // top-level: show topics
      children = Array.from(this.topicsInTreeView.values());
    } else if (element instanceof KafkaTopic) {
      // expanding a topic to show its subject(s)
      const cachedTopic: KafkaTopic | undefined = this.topicsInTreeView.get(element.name);
      if (!cachedTopic) {
        return [];
      }

      if (cachedTopic.children && cachedTopic.children.length > 0) {
        children = cachedTopic.children;
      } else if (cachedTopic.hasSchema) {
        // need to load subjects for this topic - this shouldn't happen
        void this.updateTopicSubjects(cachedTopic);
      }
    } else if (element instanceof Subject) {
      // expanding a subject to show its schema version(s)
      const cachedSubject: Subject | undefined = this.subjectsInTreeView.get(element.name);
      if (!cachedSubject) {
        return [];
      }
      if (cachedSubject.schemas !== null) {
        // already fetched schemas for this subject, return whatever is cached
        children = cachedSubject.schemas;
      } else {
        // no schema versions fetched yet; kick off background fetch that will update the expanded
        // subject directly once schema versions are fetched
        void this.updateSubjectSchemas(cachedSubject);
      }
    }

    return this.filterChildren(element, children);
  }

  getTreeItem(element: TopicViewProviderData): TreeItem {
    let treeItem: TreeItem;
    if (element instanceof KafkaTopic) {
      treeItem = new KafkaTopicTreeItem(element);
    } else if (element instanceof Subject) {
      treeItem = new SubjectTreeItem(element);
    } else if (element instanceof Schema) {
      treeItem = new SchemaTreeItem(element);
    } else {
      treeItem = element as TreeItem;
    }

    this.adjustTreeItemForSearch(element, treeItem);

    return treeItem;
  }

  /** Repaint the topics view. When invoked from the 'refresh' button, will force deep reading from sidecar. */
  async refresh(
    forceDeepRefresh: boolean = false,
    resourceToCheck: KafkaCluster | KafkaTopic | null = null,
  ): Promise<void> {
    const shouldRefresh =
      // nothing passed = refresh
      resourceToCheck === null ||
      // a cluster was passed and matches the focused cluster = refresh
      (resourceToCheck instanceof KafkaCluster &&
        this.kafkaCluster !== null &&
        this.kafkaCluster.equals(resourceToCheck)) ||
      // a topic was passed and is contained in the focused cluster = refresh
      (resourceToCheck instanceof KafkaTopic &&
        this.kafkaCluster !== null &&
        this.kafkaCluster.contains(resourceToCheck));

    if (!shouldRefresh) {
      // focused on something else; exit early
      return;
    }

    this.clearCaches();
    if (!this.kafkaCluster) {
      // nothing focused; return to empty state
      this._onDidChangeTreeData.fire();
      return;
    }

    const cluster: KafkaCluster = this.kafkaCluster;
    await this.withProgress("Loading topics...", async () => {
      await this.refreshTopics(cluster, forceDeepRefresh);
    });
  }

  async refreshTopics(cluster: KafkaCluster, forceDeepRefresh: boolean): Promise<void> {
    const loader = ResourceLoader.getInstance(cluster.connectionId);
    try {
      const topics = await loader.getTopicsForCluster(cluster, forceDeepRefresh);
      topics.forEach((topic) => {
        // update topic and subject caches before firing change event
        this.topicsInTreeView.set(topic.name, topic);
        if (topic.children && topic.children.length > 0) {
          topic.children.forEach((subject) => {
            this.subjectsInTreeView.set(subject.name, subject);
            this.subjectToTopicMap.set(subject.name, topic);
          });
        }
      });
    } catch (err) {
      this.logger.error("Error fetching topics for cluster", cluster, err);
      if (err instanceof TopicFetchError) {
        window.showErrorMessage(
          `Failed to list topics for cluster "${cluster.name}": ${err.message}`,
        );
      }
    }

    this._onDidChangeTreeData.fire();
  }

  /** Fetch and update {@link Subject subjects} for a specific {@link KafkaTopic topic}. */
  private async updateTopicSubjects(topic: KafkaTopic): Promise<void> {
    await this.withProgress(`Loading schemas for ${topic.name}...`, async () => {
      this.logger.debug("updateTopicSubjects(): Fetching subjects for topic", {
        topic: topic.name,
      });

      const loader = ResourceLoader.getInstance(topic.connectionId);
      const subjects = await loader.getTopicSubjectGroups(topic);

      const topicInMap = this.topicsInTreeView.get(topic.name);
      if (topicInMap) {
        // update cached topic for subject associations and fire change event
        topicInMap.children = subjects;
        subjects.forEach((subject) => {
          this.subjectsInTreeView.set(subject.name, subject);
          this.subjectToTopicMap.set(subject.name, topicInMap);
        });
        this._onDidChangeTreeData.fire(topicInMap);
      }
    });
  }

  /** Fetch and cache {@link Schema schemas} for a specific {@link Subject subject}. */
  private async updateSubjectSchemas(subject: Subject): Promise<void> {
    if (!this.kafkaCluster) {
      return;
    }

    this.logger.debug("updateSubjectSchemas(): Fetching schemas for subject", {
      subject: subject.name,
    });

    const loader = ResourceLoader.getInstance(subject.connectionId);
    const schemas = await loader.getSchemasForSubject(subject.environmentId, subject.name);

    subject.schemas = schemas;
    this._onDidChangeTreeData.fire(subject);
  }

  /** Get the parent of the given element, or `undefined` if it's a root-level item. */
  getParent(element: TopicViewProviderData): TopicViewProviderData | undefined {
    if (element instanceof KafkaTopic) {
      // root-level item
      return;
    }
    if (element instanceof Subject) {
      return this.subjectToTopicMap.get(element.name);
    }
    if (element instanceof Schema) {
      return this.subjectsInTreeView.get(element.subject);
    }
  }

  /** Reveal the given item in the topics tree view, optionally selecting and/or focusing it. */
  async reveal(
    item: TopicViewProviderData,
    options?: { select?: boolean; focus?: boolean },
  ): Promise<void> {
    // callers likely won't have the exact instance in the provider's cache(s), so we need to
    // find the instance (originally returned by getChildren()) by name
    let itemToReveal: TopicViewProviderData | undefined;

    if (item instanceof KafkaTopic) {
      itemToReveal = this.topicsInTreeView.get(item.name);
    } else if (item instanceof Subject) {
      itemToReveal = this.subjectsInTreeView.get(item.name);
    } else if (item instanceof Schema) {
      const parentSubject = this.subjectsInTreeView.get(item.subject);
      if (parentSubject && parentSubject.schemas) {
        itemToReveal = parentSubject.schemas.find((schema) => schema.id === item.id);
      }
    }

    if (itemToReveal) {
      await this.treeView.reveal(itemToReveal, options);
    } else {
      this.logger.warn("Could not reveal item in topics view; not found in current tree view", {
        item,
      });
    }
  }

  async reset(): Promise<void> {
    this.clearCaches();
    await super.reset();
  }

  setCustomEventListeners(): Disposable[] {
    return [
      environmentChanged.event(this.environmentChangedHandler.bind(this)),
      localKafkaConnected.event(this.localKafkaConnectedHandler.bind(this)),
      schemaSubjectChanged.event(this.subjectChangeHandler.bind(this)),
      schemaVersionsChanged.event(this.subjectChangeHandler.bind(this)),
    ];
  }

  async environmentChangedHandler(envEvent: EnvironmentChangeEvent): Promise<void> {
    if (this.kafkaCluster && this.kafkaCluster.environmentId === envEvent.id) {
      if (!envEvent.wasDeleted) {
        this.logger.debug(
          "environmentChanged event fired with matching Kafka cluster env ID, updating view description",
          { envEvent },
        );
        await this.updateTreeViewDescription();
        await this.refresh();
      } else {
        this.logger.debug(
          "environmentChanged deletion event fired with matching Kafka cluster env ID, resetting view",
          { envEvent },
        );
        await this.reset();
      }
    }
  }

  async localKafkaConnectedHandler(connected: boolean): Promise<void> {
    if (this.kafkaCluster && isLocal(this.kafkaCluster)) {
      // any transition of local resource availability should reset the tree view if we're focused
      // on a local Kafka cluster
      this.logger.debug(
        "Resetting topics view due to localKafkaConnected event and currently focused on a local cluster",
        { connected },
      );
      await this.reset();
    }
  }

  async subjectChangeHandler(event: SubjectChangeEvent | SchemaVersionChangeEvent): Promise<void> {
    const { subject, change } = event;

    if (this.kafkaCluster?.environmentId === subject.environmentId) {
      this.logger.debug(
        `A schema subject ${change} in the environment being viewed, refreshing toplevel`,
        { subject: subject.name },
      );

      // Toplevel (deep) repaint to reevaluate which topics have subjects.
      await this.refresh(true);
    }
  }

  /** Are we currently viewing a CCloud-based Kafka cluster? */
  isFocusedOnCCloud(): boolean {
    return this.kafkaCluster !== null && isCCloud(this.kafkaCluster);
  }
}
