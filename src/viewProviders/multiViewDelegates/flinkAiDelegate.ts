import type { TreeItem } from "vscode";
import { extractResponseBody, isResponseError, logError } from "../../errors";
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
   * Converts a promise rejection reason to an Error instance with a user-friendly message.
   * For HTTP response errors, extracts the error message from the response body.
   * @param reason - Unknown rejection reason
   * @returns Error instance with detailed message
   */
  private async toError(reason: unknown): Promise<Error> {
    if (!(reason instanceof Error)) {
      return new Error(String(reason));
    }

    // Not a ResponseError, return as-is
    if (!isResponseError(reason)) {
      return reason;
    }

    // Handle ResponseError with HTTP details
    try {
      const responseBody = await extractResponseBody(reason);
      const statusCode = reason.response.status;
      let errorMessage: string | undefined;

      if (typeof responseBody === "object" && responseBody !== null) {
        errorMessage =
          responseBody.message || responseBody.detail || responseBody.title || responseBody.error;
      } else if (typeof responseBody === "string") {
        errorMessage = responseBody;
      }

      if (errorMessage) {
        return new Error(`HTTP ${statusCode}: ${errorMessage}`);
      }

      return new Error(`HTTP ${statusCode}: ${reason.response.statusText}`);
    } catch {
      // If body extraction fails, return original error
      return reason;
    }
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
   * Fetches Flink AI resources (connections, tools, models, and agents) for the given database.
   * Handles partial failures gracefully by logging errors and continuing with available resources.
   * @param database - The CCloud Flink database and Kafka cluster
   * @param forceDeepRefresh - Whether to bypass cache and refresh from source
   * @returns Promise resolving to array of fetched Flink AI resources and containers
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

    const errors: [string, Error][] = [];
    const resources: FlinkAIViewModeData[] = [];

    // Process each resource type
    if (connections.status === "fulfilled") {
      this.connections = connections.value;
      resources.push(...this.connections);
    } else {
      errors.push(["Flink AI Connections", await this.toError(connections.reason)]);
    }

    if (tools.status === "fulfilled") {
      this.tools = tools.value;
      resources.push(...this.tools);
    } else {
      errors.push(["Flink AI Tools", await this.toError(tools.reason)]);
    }

    if (models.status === "fulfilled") {
      this.models = models.value;
      resources.push(...this.models);
    } else {
      errors.push(["Flink AI Models", await this.toError(models.reason)]);
    }

    if (agents.status === "fulfilled") {
      this.agents = agents.value;
      resources.push(...this.agents);
    } else {
      errors.push(["Flink AI Agents", await this.toError(agents.reason)]);
    }

    if (errors.length > 0) {
      for (const [resource, error] of errors) {
        logError(error, `Failed to load ${resource}`);
      }

      const resourceList = errors.map(([resource]) => resource).join(", ");
      const errorMessage = `Failed to load ${errors.length} resource${errors.length > 1 ? "s" : ""}: ${resourceList}. ${errors.map(([, error]) => error.message).join("; ")}`;

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
