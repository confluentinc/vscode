import { TreeItem } from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import {
  getRelationsAndColumnsSystemCatalogQuery,
  parseRelationsAndColumnsSystemCatalogQueryResponse,
  RawRelationsAndColumnsRow,
} from "../../loaders/relationsAndColumnsSystemCatalogQuery";
import { Logger } from "../../logging";
import { FlinkUdf, FlinkUdfTreeItem } from "../../models/flinkUDF";
import { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";

const logger = new Logger("flinkUDFsDelegate");

export class FlinkUDFsDelegate extends ViewProviderDelegate<
  FlinkDatabaseViewProviderMode,
  CCloudFlinkDbKafkaCluster,
  FlinkUdf
> {
  readonly mode = FlinkDatabaseViewProviderMode.UDFs;
  readonly viewTitle = "Flink UDFs (Preview)";
  readonly loadingMessage = "Loading Flink UDFs...";

  async fetchChildren(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkUdf[]> {
    this.children = [];

    const ccloudResourceLoader = CCloudResourceLoader.getInstance();
    this.children = await ccloudResourceLoader.getFlinkUDFs(database, forceDeepRefresh);

    // temp block
    const query = getRelationsAndColumnsSystemCatalogQuery(database);
    const relationsAndColumns =
      await ccloudResourceLoader.executeBackgroundFlinkStatement<RawRelationsAndColumnsRow>(
        query,
        database,
      );
    const relations = parseRelationsAndColumnsSystemCatalogQueryResponse(relationsAndColumns);

    logger.info("relationsAndColumns:", JSON.stringify(relations, null, 2));

    // end temp block

    return this.children;
  }

  getTreeItem(element: FlinkUdf): TreeItem {
    return new FlinkUdfTreeItem(element);
  }
}
