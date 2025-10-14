import { TreeItem } from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { FlinkUdf, FlinkUdfTreeItem } from "../../models/flinkSystemCatalog";
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

    return this.children;
  }

  getTreeItem(element: FlinkUdf): TreeItem {
    return new FlinkUdfTreeItem(element);
  }
}
