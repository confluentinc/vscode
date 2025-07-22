import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { ccloudAuthSessionInvalidated, currentFlinkArtifactsPoolChanged } from "../emitters";
import { isResponseError } from "../errors";
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

  parentResourceChangedEmitter = currentFlinkArtifactsPoolChanged;
  parentResourceChangedContextValue = ContextValues.flinkArtifactsPoolSelected;
  private _artifacts: FlinkArtifact[] = [];

  protected setCustomEventListeners(): Disposable[] {
    // Listen for auth session invalidation to clear the view
    const authInvalidatedSub: Disposable = ccloudAuthSessionInvalidated.event(() => {
      this._artifacts = [];
      this._onDidChangeTreeData.fire();
    });

    return [authInvalidatedSub];
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
            this.logger.error("Failed to load Flink artifacts", { error });

            // Check if this is an auth error (401 Unauthorized)
            if (isResponseError(error) && error.response.status === 401) {
              // Signal that the auth session is invalid
              ccloudAuthSessionInvalidated.fire();
            }

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
