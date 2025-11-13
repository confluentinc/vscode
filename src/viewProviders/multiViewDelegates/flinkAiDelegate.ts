import { TreeItem } from "vscode";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResource";

// replace with a union of resource classes once available:
// - FlinkAIConnection https://github.com/confluentinc/vscode/issues/2982
// - FlinkAITool https://github.com/confluentinc/vscode/issues/2995
// - FlinkAIModel https://github.com/confluentinc/vscode/issues/2987
// - FlinkAIAgent https://github.com/confluentinc/vscode/issues/2999
type FlinkAIResource = any;
type FlinkAIViewModeData = FlinkDatabaseResourceContainer<FlinkAIResource> | FlinkAIResource;

export class FlinkAIDelegate extends ViewProviderDelegate<
  FlinkDatabaseViewProviderMode,
  CCloudFlinkDbKafkaCluster,
  FlinkAIViewModeData
> {
  readonly mode = FlinkDatabaseViewProviderMode.AI;
  readonly viewTitle = "Flink AI";
  readonly loadingMessage = "Loading Flink AI resources...";

  // update these for specific types instead of the union once available:
  // - FlinkAIConnection[] https://github.com/confluentinc/vscode/issues/2982
  private connections: FlinkAIResource[] = [];
  // - FlinkAITool[] https://github.com/confluentinc/vscode/issues/2995
  private tools: FlinkAIResource[] = [];
  // - FlinkAIModel[] https://github.com/confluentinc/vscode/issues/2987
  private models: FlinkAIResource[] = [];
  // - FlinkAIAgent[] https://github.com/confluentinc/vscode/issues/2999
  private agents: FlinkAIResource[] = [];

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    database: CCloudFlinkDbKafkaCluster,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIResource[]> {
    // for follow-up branches: update these sections with actual Flink AI resource fetching logic
    // using the CCloudResourceLoader to populate these arrays:

    // - FlinkAIConnection[] https://github.com/confluentinc/vscode/issues/2983
    // this.connections = await ccloudResourceLoader.getFlinkAIConnections(database);
    this.connections = [];

    // - FlinkAITool[] https://github.com/confluentinc/vscode/issues/2996
    // this.tools = await ccloudResourceLoader.getFlinkAITools(database);
    this.tools = [];

    // - FlinkAIModel[] https://github.com/confluentinc/vscode/issues/2988
    // this.models = await ccloudResourceLoader.getFlinkAIModels(database);
    this.models = [];

    // - FlinkAIAgent[] https://github.com/confluentinc/vscode/issues/3002
    // this.agents = await ccloudResourceLoader.getFlinkAIAgents(database);
    this.agents = [];

    return [...this.connections, ...this.tools, ...this.models, ...this.agents];
  }

  getTreeItem(element: FlinkAIViewModeData): TreeItem {
    if (element instanceof FlinkDatabaseResourceContainer) {
      // already a TreeItem subclass, no need to do anything
      return element;
    }
    // replace with TreeItem models depending on element type, see:
    // - FlinkAIConnectionTreeItem https://github.com/confluentinc/vscode/issues/2982
    // - FlinkAIToolTreeItem https://github.com/confluentinc/vscode/issues/2995
    // - FlinkAIModelTreeItem https://github.com/confluentinc/vscode/issues/2987
    // - FlinkAIAgentTreeItem https://github.com/confluentinc/vscode/issues/2999
    return new TreeItem(element);
  }
}
