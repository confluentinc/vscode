import type { TreeItem } from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkAIModel, FlinkAIModelTreeItem } from "../../models/flinkAiModel";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResource";

// extend FlinkAIResource union with resource classes once available:
// - FlinkAIConnection https://github.com/confluentinc/vscode/issues/2982
// - FlinkAITool https://github.com/confluentinc/vscode/issues/2995
// - FlinkAIAgent https://github.com/confluentinc/vscode/issues/2999
type FlinkAIResource = FlinkAIModel;
export type FlinkAIViewModeData = FlinkDatabaseResourceContainer<FlinkAIResource> | FlinkAIResource;

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
  private models: FlinkAIModel[] = [];
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
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIViewModeData[]> {
    const loader = CCloudResourceLoader.getInstance();

    // for follow-up branches: update these sections with actual Flink AI resource fetching logic
    // using the CCloudResourceLoader to populate these arrays:

    // - FlinkAIConnection[] https://github.com/confluentinc/vscode/issues/2983
    // this.connections = await loader.getFlinkAIConnections(database);
    this.connections = [];

    // - FlinkAITool[] https://github.com/confluentinc/vscode/issues/2996
    // this.tools = await loader.getFlinkAITools(database);
    this.tools = [];

    this.models = await loader.getFlinkAIModels(database, forceDeepRefresh);

    // - FlinkAIAgent[] https://github.com/confluentinc/vscode/issues/3002
    // this.agents = await loader.getFlinkAIAgents(database);
    this.agents = [];

    return [...this.connections, ...this.tools, ...this.models, ...this.agents];
  }

  getTreeItem(element: FlinkAIViewModeData): TreeItem {
    if (element instanceof FlinkDatabaseResourceContainer) {
      // already a TreeItem subclass, no need to do anything
      return element;
    }
    if (element instanceof FlinkAIModel) {
      return new FlinkAIModelTreeItem(element);
    }
    // replace with TreeItem models depending on element type, see:
    // - FlinkAIConnectionTreeItem https://github.com/confluentinc/vscode/issues/2982
    // - FlinkAIToolTreeItem https://github.com/confluentinc/vscode/issues/2995
    // - FlinkAIAgentTreeItem https://github.com/confluentinc/vscode/issues/2999
    return element;
  }
}
