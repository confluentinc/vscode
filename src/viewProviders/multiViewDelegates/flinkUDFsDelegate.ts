import { TreeItem } from "vscode";
import { FlinkUdf, FlinkUdfTreeItem } from "../../models/flinkUDF";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { type FlinkArtifactsUDFsViewProvider } from "../flinkArtifacts";
import { FlinkArtifactsViewProviderMode } from "./constants";

export class FlinkUDFsDelegate extends ViewProviderDelegate<
  FlinkArtifactsViewProviderMode,
  FlinkUdf
> {
  readonly mode = FlinkArtifactsViewProviderMode.UDFs;
  readonly viewTitle = "Flink UDFs (Preview)";

  children: FlinkUdf[] = [];

  loadingMessage = "Loading Flink UDFs...";

  constructor(readonly parent: FlinkArtifactsUDFsViewProvider) {
    super();
  }

  async fetchChildren(): Promise<FlinkUdf[]> {
    this.children = [];

    if (this.parent.computePool) {
      // TODO: replace this when https://github.com/confluentinc/vscode/issues/2310 is done
      this.children = [
        new FlinkUdf({
          connectionId: this.parent.computePool!.connectionId,
          connectionType: this.parent.computePool!.connectionType,
          environmentId: this.parent.computePool!.environmentId,
          id: "example-udf",
          name: "Example UDF",
          description: "This is an example UDF for demonstration purposes.",
          provider: this.parent.computePool!.provider,
          region: this.parent.computePool!.region,
        }),
      ];
    }
    return this.children;
  }

  getTreeItem(element: FlinkUdf): TreeItem {
    return new FlinkUdfTreeItem(element);
  }
}
