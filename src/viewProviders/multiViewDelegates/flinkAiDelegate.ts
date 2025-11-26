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

  async fetchChildren(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIViewModeData[]> {
    const loader = CCloudResourceLoader.getInstance();

    const results = await Promise.allSettled([
      loader.getFlinkAIConnections(database, forceDeepRefresh),
      loader.getFlinkAITools(database, forceDeepRefresh),
      loader.getFlinkAIModels(database, forceDeepRefresh),
      loader.getFlinkAIAgents(database, forceDeepRefresh),
    ]);

    const errors: [string, Error][] = [];
    for (const result of results) {
      if (result.status === "rejected") {
        errors.push(["Flink AI resources", result.reason as Error]);
      }
    }
    if (errors.length) {
      let errorMessage = "";
      for (const [resource, error] of errors) {
        errorMessage = `${errorMessage}\n${resource} failed to load: ${error.message}`;
      }
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
