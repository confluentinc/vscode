import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { currentFlinkArtifactsPoolChanged } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { ParentedBaseViewProvider } from "./base";

export class FlinkArtifactsViewProvider
  extends ParentedBaseViewProvider<CCloudFlinkComputePool, FlinkArtifact>
  implements TreeDataProvider<FlinkArtifact>
{
  readonly kind = "flinkArtifacts";
  loggerName = "viewProviders.flinkArtifacts";
  viewId = "confluent-flink-artifacts";

  private _artifacts: FlinkArtifact[] = [];

  protected setCustomEventListeners(): Disposable[] {
    const poolChangedSub = currentFlinkArtifactsPoolChanged.event(async (pool) => {
      await this.setParentResource(pool);
    });

    return [poolChangedSub];
  }

  getChildren(element?: FlinkArtifact): FlinkArtifact[] {
    if (!this.computePool) {
      return [];
    }
    return this.filterChildren(element, this._artifacts);
  }

  async refresh(): Promise<void> {
    this._artifacts = [];

    if (this.computePool) {
      // Immediately inform the view that we (temporarily) have no data so it will clear.
      this._onDidChangeTreeData.fire();

      await this.withProgress(
        "Loading Flink artifacts...",
        async () => {
          try {
            const loader = CCloudResourceLoader.getInstance();
            this._artifacts = await loader.getFlinkArtifacts(this.computePool!);
          } catch (error) {
            this.logger.error("Error refreshing Flink artifacts", error);
            throw error;
          }
        },
        false,
      );
    }

    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FlinkArtifact): TreeItem {
    return new FlinkArtifactTreeItem(element);
  }

  get computePool(): CCloudFlinkComputePool | null {
    return this.resource;
  }
}
