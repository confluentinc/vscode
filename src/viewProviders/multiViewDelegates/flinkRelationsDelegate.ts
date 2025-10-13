import { TreeItem } from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import {
  getRelationsAndColumnsSystemCatalogQuery,
  parseRelationsAndColumnsSystemCatalogQueryResponse,
  RawRelationsAndColumnsRow,
} from "../../loaders/utils/relationsAndColumnsSystemCatalogQuery";
import { FlinkRelation, FlinkRelationColumn } from "../../models/flinkSystemCatalog";
import { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
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
    this.children = [];

    const ccloudResourceLoader = CCloudResourceLoader.getInstance();

    // temp block
    const query = getRelationsAndColumnsSystemCatalogQuery(database);
    const relationsAndColumns =
      await ccloudResourceLoader.executeBackgroundFlinkStatement<RawRelationsAndColumnsRow>(
        query,
        database,
      );
    this.children = parseRelationsAndColumnsSystemCatalogQueryResponse(relationsAndColumns);

    // end temp block

    return this.children;
  }

  getTreeItem(element: FlinkRelationElements): TreeItem {
    return element.getTreeItem();
  }
}
