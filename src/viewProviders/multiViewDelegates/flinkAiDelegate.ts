import type { TreeItem } from "vscode";
import { logError } from "../../errors";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkAIAgent, FlinkAIAgentTreeItem } from "../../models/flinkAiAgent";
import { FlinkAIConnection, FlinkAIConnectionTreeItem } from "../../models/flinkAiConnection";
import { FlinkAIModel, FlinkAIModelTreeItem } from "../../models/flinkAiModel";
import { FlinkAITool, FlinkAIToolTreeItem } from "../../models/flinkAiTool";
import type { FlinkAIResource } from "../../models/flinkDatabaseResource";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { showErrorNotificationWithButtons } from "../../notifications";
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

  /**
   * Fetches Flink AI resources for the given database.
   * @param database CCloudFlinkDbKafkaCluster
   * @param forceDeepRefresh boolean
   * @returns resources FlinkAIViewModeData[]
   */
  async fetchChildren(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIViewModeData[]> {
    const loader = CCloudResourceLoader.getInstance();

    // Use object to track results by resource type for clarity and maintainability
    const results = {
      connections: await Promise.allSettled([
        loader.getFlinkAIConnections(database, forceDeepRefresh),
      ]),
      tools: await Promise.allSettled([loader.getFlinkAITools(database, forceDeepRefresh)]),
      models: await Promise.allSettled([loader.getFlinkAIModels(database, forceDeepRefresh)]),
      agents: await Promise.allSettled([loader.getFlinkAIAgents(database, forceDeepRefresh)]),
    };

    const errors: [string, Error][] = [];
    const resources: FlinkAIViewModeData[] = [];

    // Process each resource type
    if (results.connections[0].status === "fulfilled") {
      this.connections = results.connections[0].value;
      resources.push(...this.connections);
    } else {
      errors.push(["Flink AI Connections", results.connections[0].reason as Error]);
    }

    if (results.tools[0].status === "fulfilled") {
      this.tools = results.tools[0].value;
      resources.push(...this.tools);
    } else {
      errors.push(["Flink AI Tools", results.tools[0].reason as Error]);
    }

    if (results.models[0].status === "fulfilled") {
      this.models = results.models[0].value;
      resources.push(...this.models);
    } else {
      errors.push(["Flink AI Models", results.models[0].reason as Error]);
    }

    if (results.agents[0].status === "fulfilled") {
      this.agents = results.agents[0].value;
      resources.push(...this.agents);
    } else {
      errors.push(["Flink AI Agents", results.agents[0].reason as Error]);
    }
    // the constraint of > 0 means empty results are not considered errors
    if (errors.length > 0) {
      for (const [resource, error] of errors) {
        logError(error, `Failed to load ${resource}`);
      }

      const resourceList = errors.map(([resource]) => resource).join(", ");
      const errorMessage = `Failed to load ${errors.length} resource${errors.length > 1 ? "s" : ""}: ${resourceList}`;

      await void showErrorNotificationWithButtons(errorMessage);
    }

    return resources;
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
