import { TreeItem } from "vscode";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkUdf, FlinkUdfTreeItem } from "../../models/flinkUDF";
import { CCloudKafkaCluster } from "../../models/kafkaCluster";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";

export class FlinkUDFsDelegate extends ViewProviderDelegate<
  FlinkDatabaseViewProviderMode,
  CCloudKafkaCluster,
  FlinkUdf
> {
  readonly mode = FlinkDatabaseViewProviderMode.UDFs;
  readonly viewTitle = "Flink UDFs (Preview)";

  children: FlinkUdf[] = [];

  loadingMessage = "Loading Flink UDFs...";

  async fetchChildren(database: CCloudKafkaCluster): Promise<FlinkUdf[]> {
    const ccloudResourceLoader = CCloudResourceLoader.getInstance();
    // TODO: replace this when https://github.com/confluentinc/vscode/issues/2310 is done
    this.children = await ccloudResourceLoader.getFlinkUDFs(database);

    return this.children;
  }

  getTreeItem(element: FlinkUdf): TreeItem {
    return new FlinkUdfTreeItem(element);
  }
}
