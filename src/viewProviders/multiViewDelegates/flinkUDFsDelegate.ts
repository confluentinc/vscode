import { TreeItem } from "vscode";
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

  async fetchChildren(resource: CCloudKafkaCluster): Promise<FlinkUdf[]> {
    this.children = [];

    // TODO: replace this when https://github.com/confluentinc/vscode/issues/2310 is done
    this.children = [
      new FlinkUdf({
        connectionId: resource.connectionId,
        connectionType: resource.connectionType,
        environmentId: resource.environmentId,
        id: "example-udf",
        name: "Example UDF",
        description: "This is an example UDF for demonstration purposes.",
        provider: resource.provider,
        region: resource.region,
      }),
    ];

    return this.children;
  }

  getTreeItem(element: FlinkUdf): TreeItem {
    return new FlinkUdfTreeItem(element);
  }
}
