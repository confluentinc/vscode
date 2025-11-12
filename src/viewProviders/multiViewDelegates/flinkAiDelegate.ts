import { TreeItem, TreeItemCollapsibleState } from "vscode";
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

  getChildren(element?: FlinkAIViewModeData): FlinkAIViewModeData[] {
    if (element instanceof FlinkDatabaseResourceContainer) {
      // expanding a Connection/Tool/Model/Agent container to list actual resources
      return element.children;
    }
    return this.children;
  }

  async fetchChildren(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    database: CCloudFlinkDbKafkaCluster,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIResource[]> {
    this.children = [];

    // for follow-up branches: update these sections with actual Flink AI resource fetching logic
    // using the CCloudResourceLoader, where the TreeItemCollapsibleState is set to None
    // when no resources of a given type are available:

    // - FlinkAIConnection[] https://github.com/confluentinc/vscode/issues/2983
    const connectionsContainer = new FlinkDatabaseResourceContainer<FlinkAIResource>(
      "Connections",
      TreeItemCollapsibleState.None,
      [],
    );

    // - FlinkAITool[] https://github.com/confluentinc/vscode/issues/2996
    const toolsContainer = new FlinkDatabaseResourceContainer<FlinkAIResource>(
      "Tools",
      TreeItemCollapsibleState.None,
      [],
    );

    // - FlinkAIModel[] https://github.com/confluentinc/vscode/issues/2988
    const modelsContainer = new FlinkDatabaseResourceContainer<FlinkAIResource>(
      "Models",
      TreeItemCollapsibleState.None,
      [],
    );

    // - FlinkAIAgent[] https://github.com/confluentinc/vscode/issues/3002
    const agentsContainer = new FlinkDatabaseResourceContainer<FlinkAIResource>(
      "Agents",
      TreeItemCollapsibleState.None,
      [],
    );

    this.children.push(connectionsContainer, toolsContainer, modelsContainer, agentsContainer);

    return this.children;
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
