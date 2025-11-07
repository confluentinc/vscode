import { TreeItem } from "vscode";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";

// replace with a union of resource classes once available:
// - FlinkAIConnection https://github.com/confluentinc/vscode/issues/2982
// - FlinkAITool https://github.com/confluentinc/vscode/issues/2995
// - FlinkAIModel https://github.com/confluentinc/vscode/issues/2987
// - FlinkAIAgent https://github.com/confluentinc/vscode/issues/2999
type FlinkAIResource = any;

export class FlinkAIDelegate extends ViewProviderDelegate<
  FlinkDatabaseViewProviderMode,
  CCloudFlinkDbKafkaCluster,
  FlinkAIResource
> {
  readonly mode = FlinkDatabaseViewProviderMode.AI;
  readonly viewTitle = "Flink AI";
  readonly loadingMessage = "Loading Flink AI resources...";

  async fetchChildren(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    database: CCloudFlinkDbKafkaCluster,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIResource[]> {
    this.children = [];

    // replace with actual Flink AI resource fetching logic in follow-up branches:
    // - FlinkAIConnection[] https://github.com/confluentinc/vscode/issues/2983
    // - FlinkAITool[] https://github.com/confluentinc/vscode/issues/2996
    // - FlinkAIModel[] https://github.com/confluentinc/vscode/issues/2988
    // - FlinkAIAgent[] https://github.com/confluentinc/vscode/issues/3002

    return this.children;
  }

  getTreeItem(element: any): TreeItem {
    // replace with TreeItem models depending on element type, see:
    // - FlinkAIConnectionTreeItem https://github.com/confluentinc/vscode/issues/2982
    // - FlinkAIToolTreeItem https://github.com/confluentinc/vscode/issues/2995
    // - FlinkAIModelTreeItem https://github.com/confluentinc/vscode/issues/2987
    // - FlinkAIAgentTreeItem https://github.com/confluentinc/vscode/issues/2999
    return new TreeItem(element);
  }
}
