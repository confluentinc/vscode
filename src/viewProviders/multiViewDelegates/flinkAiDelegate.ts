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

  /**
   * Converts a promise rejection reason to an Error instance.
   * @param reason Unknown rejection reason
   * @returns Error instance
   */
  private toError(reason: unknown): Error {
    return reason instanceof Error ? reason : new Error(String(reason));
  }

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

    const [connections, tools, models, agents] = await Promise.allSettled([
      loader.getFlinkAIConnections(database, forceDeepRefresh),
      loader.getFlinkAITools(database, forceDeepRefresh),
      loader.getFlinkAIModels(database, forceDeepRefresh),
      loader.getFlinkAIAgents(database, forceDeepRefresh),
    ]);

    const results = { connections, tools, models, agents };

    const resourceConfigs = [
      {
        key: "connections" as const,
        label: "Flink AI Connections",
        setter: (values: FlinkAIConnection[]) => {
          this.connections = values;
        },
      },
      {
        key: "tools" as const,
        label: "Flink AI Tools",
        setter: (values: FlinkAITool[]) => {
          this.tools = values;
        },
      },
      {
        key: "models" as const,
        label: "Flink AI Models",
        setter: (values: FlinkAIModel[]) => {
          this.models = values;
        },
      },
      {
        key: "agents" as const,
        label: "Flink AI Agents",
        setter: (values: FlinkAIAgent[]) => {
          this.agents = values;
        },
      },
    ];

    const errors: [string, Error][] = [];
    const resources: FlinkAIViewModeData[] = [];

    for (const config of resourceConfigs) {
      const result = results[config.key];
      if (result.status === "fulfilled") {
        config.setter(result.value);
        resources.push(...result.value);
      } else {
        errors.push([config.label, this.toError(result.reason)]);
      }
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
