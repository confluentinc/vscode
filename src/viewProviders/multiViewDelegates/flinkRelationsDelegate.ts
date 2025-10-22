import type { TreeItem } from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import type { FlinkRelation, FlinkRelationColumn } from "../../models/flinkRelation";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";

export type FlinkRelationElements = FlinkRelation | FlinkRelationColumn;

export class FlinkRelationsDelegate extends ViewProviderDelegate<
  FlinkDatabaseViewProviderMode,
  CCloudFlinkDbKafkaCluster,
  FlinkRelationElements
> {
  readonly mode = FlinkDatabaseViewProviderMode.Relations;
  readonly viewTitle = "Flink Relations (Preview)";
  readonly loadingMessage = "Loading Flink Relations...";

  /** Returns the most recent results from fetchChildren() */
  getChildren(parent?: FlinkRelation): FlinkRelationElements[] {
    if (parent) {
      return parent.columns;
    }
    return this.children;
  }

  async fetchChildren(database: CCloudFlinkDbKafkaCluster): Promise<FlinkRelationElements[]> {
    const ccloudResourceLoader = CCloudResourceLoader.getInstance();

    this.children = await ccloudResourceLoader.getFlinkRelations(database);

    return this.children;
  }

  getTreeItem(element: FlinkRelationElements): TreeItem {
    return element.getTreeItem();
  }
}
