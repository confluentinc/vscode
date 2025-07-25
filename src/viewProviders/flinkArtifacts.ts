import { TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { currentFlinkArtifactsPoolChanged } from "../emitters";
import { isResponseError, logError } from "../errors";
import { CCloudResourceLoader } from "../loaders";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { showErrorNotificationWithButtons } from "../notifications";
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
            logError(error, "Failed to load Flink artifacts");

            // Check for HTTP error status codes and show user notifications
            if (isResponseError(error)) {
              const status = error.response.status;
              if (status >= 400 && status < 600) {
                let errorMessage = "Failed to load Flink artifacts.";

                if (status >= 400 && status < 500) {
                  errorMessage += " Please check your permissions and try again.";
                } else if (status >= 500) {
                  errorMessage +=
                    " The service is temporarily unavailable. Please try again later.";
                }

                await showErrorNotificationWithButtons(errorMessage);
              }
            } else {
              // For non-HTTP errors (network issues, etc.)
              await showErrorNotificationWithButtons(
                "Failed to load Flink artifacts. Please check your connection and try again.",
              );
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
