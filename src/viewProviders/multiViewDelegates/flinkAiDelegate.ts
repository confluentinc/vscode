import type { TreeItem } from "vscode";
import * as vscode from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkAIAgent, FlinkAIAgentTreeItem } from "../../models/flinkAiAgent";
import { FlinkAIConnection, FlinkAIConnectionTreeItem } from "../../models/flinkAiConnection";
import { FlinkAIModel, FlinkAIModelTreeItem } from "../../models/flinkAiModel";
import { FlinkAITool, FlinkAIToolTreeItem } from "../../models/flinkAiTool";
import type { FlinkAIResource } from "../../models/flinkDatabaseResource";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResourceContainer";

export type FlinkAIViewModeData = FlinkDatabaseResourceContainer<FlinkAIResource> | FlinkAIResource;

export class FlinkAIDelegate extends ViewProviderDelegate<
  FlinkDatabaseViewProviderMode,
  CCloudFlinkDbKafkaCluster,
  FlinkAIViewModeData
> {
  readonly mode = FlinkDatabaseViewProviderMode.AI;
  readonly viewTitle = "Flink AI";
  readonly loadingMessage = "Loading Flink AI resources...";

  private connections: FlinkAIConnection[] = [];
  private tools: FlinkAITool[] = [];
  private models: FlinkAIModel[] = [];
  private agents: FlinkAIAgent[] = [];

  getChildren(element?: FlinkAIViewModeData): FlinkAIViewModeData[] {
    if (element instanceof FlinkDatabaseResourceContainer) {
      // expanding a Connection/Tool/Model/Agent container to list actual resources
      return element.children;
    }

    // create containers fresh each time to avoid stale tree item properties (e.g. from search
    // decoration) since we don't need to worry about caching them since they aren't connected to
    // any specific data source
    const connectionsContainer = new FlinkDatabaseResourceContainer(
      "Connections",
      this.connections,
    );
    const toolsContainer = new FlinkDatabaseResourceContainer("Tools", this.tools);
    const modelsContainer = new FlinkDatabaseResourceContainer("Models", this.models);
    const agentsContainer = new FlinkDatabaseResourceContainer("Agents", this.agents);

    return [connectionsContainer, toolsContainer, modelsContainer, agentsContainer];
  }
  modelsError: Error | undefined;
  agentsError: Error | undefined;
  connectionsError: Error | undefined;
  toolsError: Error | undefined;

  async fetchFlinkAIModels(
    loader: CCloudResourceLoader,
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<[FlinkAIModel[], Error | null]> {
    try {
      const models = await loader.getFlinkAIModels(database, forceDeepRefresh);
      return [models, null];
    } catch (error) {
      return [[], error as Error];
    }
  }
  async fetchFlinkAIConnections(
    loader: CCloudResourceLoader,
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<[FlinkAIConnection[], Error | null]> {
    try {
      const connections = await loader.getFlinkAIConnections(database, forceDeepRefresh);
      return [connections, null];
    } catch (error) {
      return [[], error as Error];
    }
  }
  async fetchFlinkAITools(
    loader: CCloudResourceLoader,
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<[FlinkAITool[], Error | null]> {
    try {
      const tools = await loader.getFlinkAITools(database, forceDeepRefresh);
      return [tools, null];
    } catch (error) {
      return [[], error as Error];
    }
  }
  async fetchFlinkAIAgents(
    loader: CCloudResourceLoader,
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<[FlinkAIAgent[], Error | null]> {
    try {
      const agents = await loader.getFlinkAIAgents(database, forceDeepRefresh);
      return [agents, null];
    } catch (error) {
      return [[], error as Error];
    }
  }

  async fetchChildren(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIViewModeData[]> {
    // clear out any errors from the last fetch attempt(s)
    const [models, modelsError] = await this.fetchFlinkAIModels(
      CCloudResourceLoader.getInstance(),
      database,
      forceDeepRefresh,
    );
    const [connections, connectionsError] = await this.fetchFlinkAIConnections(
      CCloudResourceLoader.getInstance(),
      database,
      forceDeepRefresh,
    );
    const [tools, toolsError] = await this.fetchFlinkAITools(
      CCloudResourceLoader.getInstance(),
      database,
      forceDeepRefresh,
    );
    const [agents, agentsError] = await this.fetchFlinkAIAgents(
      CCloudResourceLoader.getInstance(),
      database,
      forceDeepRefresh,
    );

    this.models = models;
    this.connections = connections;
    this.tools = tools;
    this.agents = agents;

    const errors: [string, Error][] = [];
    if (modelsError) errors.push(["Models", modelsError]);
    if (connectionsError) errors.push(["Connections", connectionsError]);
    if (toolsError) errors.push(["Tools", toolsError]);
    if (agentsError) errors.push(["Agents", agentsError]);

    if (errors.length) {
      const errorMessage = errors
        .map(([resource, error]) => `${resource} failed to load: ${error.message}`)
        .join("\n");
      vscode.window.showErrorMessage(errorMessage);
    }

    return this.getChildren();
  }

  getTreeItem(element: FlinkAIViewModeData): TreeItem {
    if (element instanceof FlinkDatabaseResourceContainer) {
      // already a TreeItem subclass, no need to do anything
      return element;
    }
    if (element instanceof FlinkAIConnection) {
      return new FlinkAIConnectionTreeItem(element);
    }
    if (element instanceof FlinkAIModel) {
      return new FlinkAIModelTreeItem(element);
    }
    if (element instanceof FlinkAITool) {
      return new FlinkAIToolTreeItem(element);
    }
    if (element instanceof FlinkAIAgent) {
      return new FlinkAIAgentTreeItem(element);
    }
    return element;
  }
}
