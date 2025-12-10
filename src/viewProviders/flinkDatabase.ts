import { ThemeIcon, type Disposable, type TreeItem } from "vscode";
import { IconNames } from "../constants";
import { ContextValues } from "../context/values";
import {
  artifactsChanged,
  flinkDatabaseViewResourceChanged,
  flinkDatabaseViewSearchSet,
  udfsChanged,
} from "../emitters";
import { extractResponseBody, isResponseError, logError } from "../errors";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { FlinkAIAgent, FlinkAIAgentTreeItem } from "../models/flinkAiAgent";
import { FlinkAIConnection, FlinkAIConnectionTreeItem } from "../models/flinkAiConnection";
import { FlinkAIModel, FlinkAIModelTreeItem } from "../models/flinkAiModel";
import { FlinkAITool, FlinkAIToolTreeItem } from "../models/flinkAiTool";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import type { FlinkAIResource, FlinkDatabaseResource } from "../models/flinkDatabaseResource";
import {
  FlinkDatabaseContainerLabel,
  FlinkDatabaseResourceContainer,
} from "../models/flinkDatabaseResourceContainer";
import type { FlinkRelationColumn } from "../models/flinkRelation";
import { FlinkRelation } from "../models/flinkRelation";
import { FlinkUdf, FlinkUdfTreeItem } from "../models/flinkUDF";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CustomMarkdownString } from "../models/main";
import type { IEnvProviderRegion } from "../models/resource";
import { ParentedBaseViewProvider } from "./baseModels/parentedBase";

/** Resource types handled by this view provider, including any resource containers. */
export type DatabaseChildrenType =
  | FlinkDatabaseResourceContainer<FlinkDatabaseResource | FlinkArtifact>
  | FlinkDatabaseResource
  // not specifically a FlinkDatabaseResource, but it's being handled here for now:
  | FlinkArtifact
  // visible when a FlinkRelation is expanded:
  | FlinkRelationColumn;

// top-level container tree items with context values for attaching commands
const RELATIONS_CONTAINER = new FlinkDatabaseResourceContainer<FlinkRelation>(
  FlinkDatabaseContainerLabel.RELATIONS,
  [],
  "flink-database-relations-container",
  new ThemeIcon(IconNames.TOPIC),
);
const ARTIFACTS_CONTAINER = new FlinkDatabaseResourceContainer<FlinkArtifact>(
  FlinkDatabaseContainerLabel.ARTIFACTS,
  [],
  "flink-database-artifacts-container",
  new ThemeIcon(IconNames.FLINK_ARTIFACT),
);
const UDFS_CONTAINER = new FlinkDatabaseResourceContainer<FlinkUdf>(
  FlinkDatabaseContainerLabel.UDFS,
  [],
  "flink-database-udfs-container",
  new ThemeIcon(IconNames.FLINK_FUNCTION),
);
const AI_CONNECTIONS_CONTAINER = new FlinkDatabaseResourceContainer<FlinkAIResource>(
  FlinkDatabaseContainerLabel.AI_CONNECTIONS,
  [],
  "flink-database-ai-connections-container",
  new ThemeIcon(IconNames.CONNECTION),
);
const AI_TOOLS_CONTAINER = new FlinkDatabaseResourceContainer<FlinkAIResource>(
  FlinkDatabaseContainerLabel.AI_TOOLS,
  [],
  "flink-database-ai-tools-container",
  new ThemeIcon(IconNames.FLINK_AI_TOOL),
);
const AI_MODELS_CONTAINER = new FlinkDatabaseResourceContainer<FlinkAIResource>(
  FlinkDatabaseContainerLabel.AI_MODELS,
  [],
  "flink-database-ai-models-container",
  new ThemeIcon(IconNames.FLINK_AI_MODEL),
);
const AI_AGENTS_CONTAINER = new FlinkDatabaseResourceContainer<FlinkAIResource>(
  FlinkDatabaseContainerLabel.AI_AGENTS,
  [],
  "flink-database-ai-agents-container",
  new ThemeIcon(IconNames.FLINK_AI_AGENT),
);

/**
 * Provider for the "Flink Database" view resources.
 * Shows Table/View Relations, UDFs, and AI resources under top-level containers for each resource type.
 *
 * NOTE: Artifacts are included here, even though they are not tied to a specific Flink database
 * (and are instead scoped to env/provider/region).
 */
export class FlinkDatabaseViewProvider extends ParentedBaseViewProvider<
  CCloudFlinkDbKafkaCluster,
  DatabaseChildrenType
> {
  viewId = "confluent-flink-database";
  kind = "flinkdatabase";
  loggerName = "viewProviders.flinkDatabase";

  parentResourceChangedEmitter = flinkDatabaseViewResourceChanged;
  parentResourceChangedContextValue = ContextValues.flinkDatabaseSelected;

  searchChangedEmitter = flinkDatabaseViewSearchSet;
  searchContextValue = ContextValues.flinkDatabaseSearchApplied;

  private readonly relationsContainer = RELATIONS_CONTAINER;
  private readonly artifactsContainer = ARTIFACTS_CONTAINER;
  private readonly udfsContainer = UDFS_CONTAINER;
  private readonly aiConnectionsContainer = AI_CONNECTIONS_CONTAINER;
  private readonly aiToolsContainer = AI_TOOLS_CONTAINER;
  private readonly aiModelsContainer = AI_MODELS_CONTAINER;
  private readonly aiAgentsContainer = AI_AGENTS_CONTAINER;

  get database(): CCloudFlinkDbKafkaCluster | null {
    return this.resource;
  }

  getChildren(element?: DatabaseChildrenType): DatabaseChildrenType[] {
    let children: DatabaseChildrenType[] = [];

    if (!this.database) {
      return children;
    }

    if (!element) {
      // top-level: show resource containers
      children = [
        this.relationsContainer,
        this.artifactsContainer,
        this.udfsContainer,
        this.aiConnectionsContainer,
        this.aiToolsContainer,
        this.aiModelsContainer,
        this.aiAgentsContainer,
      ];
    } else if (element instanceof FlinkDatabaseResourceContainer) {
      // expanding a container to list actual resources
      children = element.children;
    } else if (element instanceof FlinkRelation) {
      // expanding a FlinkRelation to show its columns
      children = element.columns;
    }

    return this.filterChildren(element, children);
  }

  getTreeItem(element: DatabaseChildrenType): TreeItem {
    let treeItem: TreeItem;

    if (element instanceof FlinkDatabaseResourceContainer) {
      // already a TreeItem (subclass)
      treeItem = element;
    } else if ("getTreeItem" in element && typeof element.getTreeItem === "function") {
      // just for FlinkRelations/FlinkRelationColumn since they use getTreeItem() instead of separate
      // classes, but we might migrate other classes to this pattern in the future
      treeItem = element.getTreeItem();
    } else if (element instanceof FlinkArtifact) {
      treeItem = new FlinkArtifactTreeItem(element);
    } else if (element instanceof FlinkUdf) {
      treeItem = new FlinkUdfTreeItem(element);
    } else if (element instanceof FlinkAIConnection) {
      treeItem = new FlinkAIConnectionTreeItem(element);
    } else if (element instanceof FlinkAIModel) {
      treeItem = new FlinkAIModelTreeItem(element);
    } else if (element instanceof FlinkAITool) {
      treeItem = new FlinkAIToolTreeItem(element);
    } else if (element instanceof FlinkAIAgent) {
      treeItem = new FlinkAIAgentTreeItem(element);
    } else {
      treeItem = element as TreeItem;
    }

    this.adjustTreeItemForSearch(element, treeItem);

    return treeItem;
  }

  /** Refresh all top-level resource containers. */
  async refresh(forceDeepRefresh: boolean = false): Promise<void> {
    if (!this.database) {
      this._onDidChangeTreeData.fire();
      return;
    }

    const database: CCloudFlinkDbKafkaCluster = this.database;
    this.logger.debug(
      `refreshing entire Flink Database view for ${database.name} (${database.id})`,
    );

    await this.withProgress(
      "Loading Flink Database resources...",
      async () => {
        await Promise.allSettled([
          this.refreshRelationsContainer(database, forceDeepRefresh),
          this.refreshArtifactsContainer(database, forceDeepRefresh),
          this.refreshUDFsContainer(database, forceDeepRefresh),
          this.refreshAIConnectionsContainer(database, forceDeepRefresh),
          this.refreshAIToolsContainer(database, forceDeepRefresh),
          this.refreshAIModelsContainer(database, forceDeepRefresh),
          this.refreshAIAgentsContainer(database, forceDeepRefresh),
        ]);
      },
      false,
    );

    this._onDidChangeTreeData.fire();
  }

  setCustomEventListeners(): Disposable[] {
    return [
      artifactsChanged.event(this.artifactsChangedHandler.bind(this)),
      udfsChanged.event(this.udfsChangedHandler.bind(this)),
    ];
  }

  /** Get resources for the given `container` based on the provided `database` and `loaderMethod`. */
  private async refreshResourceContainer<T extends FlinkDatabaseResource | FlinkArtifact>(
    database: CCloudFlinkDbKafkaCluster,
    container: FlinkDatabaseResourceContainer<FlinkDatabaseResource | FlinkArtifact>,
    loaderMethod: (database: CCloudFlinkDbKafkaCluster, forceDeepRefresh: boolean) => Promise<T[]>,
    forceDeepRefresh: boolean = false,
  ): Promise<T[]> {
    this.logger.debug(
      `refreshing ${container.label} resources for ${database.name} (${database.id})...`,
    );
    // set initial loading state
    container.isLoading = true;
    this._onDidChangeTreeData.fire(container);

    let results: T[] = [];
    try {
      results = await loaderMethod(database, forceDeepRefresh);
      // clear any loading/error state and only refresh the provided container to show updated items
      container.children = results;
      container.tooltip = new CustomMarkdownString();
      container.hasError = false;
      this._onDidChangeTreeData.fire(container);
    } catch (error) {
      let errorMsg = String(error);
      let errorLanguage = "";
      if (isResponseError(error)) {
        const responseBody = await extractResponseBody(error);
        errorMsg = responseBody?.message || JSON.stringify(responseBody, null, 2);
        errorLanguage = "json";
      }
      const msg = `Failed to load ${container.label} for **${database.name}** (${database.id}):`;
      logError(error, `${msg} ${errorMsg}`);
      // clear the loading state and show error info as tooltip (and icon through setting hasError)
      container.children = [];
      container.tooltip = new CustomMarkdownString()
        .addWarning(msg)
        .addCodeBlock(errorMsg, errorLanguage);
      container.hasError = true;
      this._onDidChangeTreeData.fire(container);
    }
    return results;
  }

  /**
   * The list of artifacts in the given env/provider/region has just changed.
   * If it matches our current database, refresh the artifacts container.
   */
  async artifactsChangedHandler(envRegion: IEnvProviderRegion): Promise<void> {
    if (this.database?.isSameEnvCloudRegion(envRegion)) {
      await this.refreshArtifactsContainer(this.database, true);
    }
  }

  /**
   * Fetch Artifacts and use the provided `database`'s environment ID and cloud provider/region
   * for storage.
   */
  async refreshArtifactsContainer(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    await this.refreshResourceContainer(
      database,
      this.artifactsContainer,
      (db, refresh) => CCloudResourceLoader.getInstance().getFlinkArtifacts(db, refresh),
      forceDeepRefresh,
    );
  }

  /**
   * The list of UDFs in the given Flink database has just changed.
   * If it matches our current database, refresh the UDFs container.
   */
  async udfsChangedHandler(dbWithUpdatedUdfs: CCloudFlinkDbKafkaCluster): Promise<void> {
    if (this.database && this.database.id === dbWithUpdatedUdfs.id) {
      await this.refreshUDFsContainer(this.database, true);
    }
  }

  /** Fetch UDFs for the given database. */
  async refreshUDFsContainer(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    await this.refreshResourceContainer(
      database,
      this.udfsContainer,
      (db, refresh) => CCloudResourceLoader.getInstance().getFlinkUDFs(db, refresh),
      forceDeepRefresh,
    );
  }

  /** Fetch table/view relations for the given database. */
  async refreshRelationsContainer(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    await this.refreshResourceContainer(
      database,
      this.relationsContainer,
      (db, refresh) => CCloudResourceLoader.getInstance().getFlinkRelations(db, refresh),
      forceDeepRefresh,
    );
  }

  /** Fetch AI Connections for the given database. */
  async refreshAIConnectionsContainer(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    await this.refreshResourceContainer(
      database,
      this.aiConnectionsContainer,
      (db, refresh) => CCloudResourceLoader.getInstance().getFlinkAIConnections(db, refresh),
      forceDeepRefresh,
    );
  }

  /** Fetch AI Tools for the given database. */
  async refreshAIToolsContainer(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    await this.refreshResourceContainer(
      database,
      this.aiToolsContainer,
      (db, refresh) => CCloudResourceLoader.getInstance().getFlinkAITools(db, refresh),
      forceDeepRefresh,
    );
  }

  /** Fetch AI Models for the given database. */
  async refreshAIModelsContainer(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    await this.refreshResourceContainer(
      database,
      this.aiModelsContainer,
      (db, refresh) => CCloudResourceLoader.getInstance().getFlinkAIModels(db, refresh),
      forceDeepRefresh,
    );
  }

  /** Fetch AI Agents for the given database. */
  async refreshAIAgentsContainer(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    await this.refreshResourceContainer(
      database,
      this.aiAgentsContainer,
      (db, refresh) => CCloudResourceLoader.getInstance().getFlinkAIAgents(db, refresh),
      forceDeepRefresh,
    );
  }

  /** Update the tree view description to show the currently-focused Flink Database's parent env
   * name and the Flink Database name. */
  async updateTreeViewDescription(): Promise<void> {
    const db = this.database;
    if (!db) {
      this.treeView.description = "";
      return;
    }
    const env = await ResourceLoader.getEnvironment(db.connectionId, db.environmentId);
    if (env) {
      this.treeView.description = `${env.name} | ${db.name}`;
    } else {
      this.treeView.description = db.name;
    }
  }
}
