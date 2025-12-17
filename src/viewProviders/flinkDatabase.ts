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
import { FlinkRelation, FlinkRelationColumn } from "../models/flinkRelation";
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

  relationsContainer = RELATIONS_CONTAINER;
  artifactsContainer = ARTIFACTS_CONTAINER;
  udfsContainer = UDFS_CONTAINER;
  aiConnectionsContainer = AI_CONNECTIONS_CONTAINER;
  aiToolsContainer = AI_TOOLS_CONTAINER;
  aiModelsContainer = AI_MODELS_CONTAINER;
  aiAgentsContainer = AI_AGENTS_CONTAINER;

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

  /** Get the parent of the given element, or `undefined` if it's a root-level item. */
  getParent(element: DatabaseChildrenType): DatabaseChildrenType | undefined {
    if (element instanceof FlinkDatabaseResourceContainer) {
      // root-level item
      return;
    }
    if (element instanceof FlinkRelationColumn) {
      // look up the FlinkRelation parent
      return this.relationsContainer.children.find((relation) =>
        relation.columns.includes(element),
      );
    }
    // the rest of these don't have nested hierarchies, so return their container
    if (element instanceof FlinkRelation) {
      return this.relationsContainer;
    }
    if (element instanceof FlinkArtifact) {
      return this.artifactsContainer;
    }
    if (element instanceof FlinkUdf) {
      return this.udfsContainer;
    }
    if (element instanceof FlinkAIConnection) {
      return this.aiConnectionsContainer;
    }
    if (element instanceof FlinkAITool) {
      return this.aiToolsContainer;
    }
    if (element instanceof FlinkAIModel) {
      return this.aiModelsContainer;
    }
    if (element instanceof FlinkAIAgent) {
      return this.aiAgentsContainer;
    }
    return;
  }

  /** Reveal a specific Flink Database resource in the view, if possible. */
  async revealResource(
    resource: DatabaseChildrenType,
    options?: { select?: boolean; focus?: boolean; expand?: number | boolean },
  ): Promise<void> {
    if (!this.database) {
      return;
    }

    const selectResource = options?.select ?? true;
    const focusResource = options?.focus ?? true;
    const expandResource = options?.expand ?? false;
    const revealOptions = { select: selectResource, focus: focusResource, expand: expandResource };

    // just for logging:
    const resourceLogLabel =
      resource instanceof FlinkDatabaseResourceContainer ? resource.label : resource.name;

    // look up the instance and reveal the item instead of the instance that was passed in since
    // VS Code needs the exact same object reference to find it in the tree
    let exactInstance: DatabaseChildrenType | undefined;
    if (resource instanceof FlinkDatabaseResourceContainer) {
      // reveal the container directly
      exactInstance = resource;
    } else if (resource instanceof FlinkRelationColumn) {
      // look up the FlinkRelation parent
      exactInstance = this.relationsContainer.children.find((relation) =>
        relation.columns.includes(resource),
      );
    } else if (resource instanceof FlinkRelation) {
      exactInstance = this.relationsContainer.children.find(
        (relation) => relation.id === resource.id,
      );
    } else if (resource instanceof FlinkArtifact) {
      exactInstance = this.artifactsContainer.children.find(
        (artifact) => artifact.id === resource.id,
      );
    } else if (resource instanceof FlinkUdf) {
      exactInstance = this.udfsContainer.children.find((udf) => udf.id === resource.id);
    } else if (resource instanceof FlinkAIConnection) {
      exactInstance = this.aiConnectionsContainer.children.find((conn) => conn.id === resource.id);
    } else if (resource instanceof FlinkAITool) {
      exactInstance = this.aiToolsContainer.children.find((tool) => tool.id === resource.id);
    } else if (resource instanceof FlinkAIModel) {
      exactInstance = this.aiModelsContainer.children.find((model) => model.id === resource.id);
    } else if (resource instanceof FlinkAIAgent) {
      exactInstance = this.aiAgentsContainer.children.find((agent) => agent.id === resource.id);
    }
    if (!exactInstance) {
      this.logger.warn(
        `Could not find resource in Flink Database view to reveal: ${resourceLogLabel} (${resource.id})`,
      );
      return;
    }

    try {
      await this.treeView.reveal(exactInstance, revealOptions);
    } catch (error) {
      logError(
        error,
        `Failed to reveal resource in Flink Database view: ${resourceLogLabel} (${resource.id})`,
      );
    }
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
      // only applies to loading artifacts, since all others are loaded via background statements
      // and won't throw HTTP response errors
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
