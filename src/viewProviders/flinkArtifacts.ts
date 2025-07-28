import { TreeDataProvider, TreeItem } from "vscode";
import { ModelError } from "../clients/flinkArtifacts";
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
      this._onDidChangeTreeData.fire();

      await this.withProgress(
        "Loading Flink artifacts...",
        async () => {
          try {
            const loader = CCloudResourceLoader.getInstance();
            this._artifacts = await loader.getFlinkArtifacts(this.computePool!);
          } catch (error) {
            let showNotification = false;
            let message = "Failed to load Flink artifacts.";

            if (isResponseError(error)) {
              const status = error.response.status;
              let errorBody: string = await error.response.clone().text();
              try {
                const { errors } = await error.response.clone().json();
                if (Array.isArray(errors) && errors.length) {
                  errorBody = errors
                    .map((data: ModelError) => data.detail ?? "")
                    .filter(Boolean)
                    .join("; ");
                }
              } catch (err) {
                this.logger.debug("Failed to parse error response as JSON", err);
                // ignore JSON parsing errors and use the raw text
              }
              // Only show notifications for error status codes
              if (status >= 400 && status < 600) {
                showNotification = true;
                switch (status) {
                  case 400:
                    message =
                      "Failed to load Flink artifacts. Please check your request and try again.";
                    break;
                  case 401:
                    message = "Authentication required to load Flink artifacts.";
                    break;
                  case 403:
                    message =
                      "Failed to load Flink artifacts. Please check your permissions and try again.";
                    break;
                  case 404:
                    message = "Flink artifacts not found for this compute pool.";
                    break;
                  case 429:
                    message = "Too many requests. Please try again later.";
                    break;
                  case 503:
                    message =
                      "Failed to load Flink artifacts. The service is temporarily unavailable. Please try again later.";
                    break;
                  default:
                    message = "Failed to load Flink artifacts due to an unexpected error.";
                    break;
                }
              }
              logError(error, "Failed to load Flink artifacts");
            } else if (error instanceof Error) {
              message =
                "Failed to load Flink artifacts. Please check your connection and try again.";
              showNotification = true;
              logError(error, "Failed to load Flink artifacts");
            } else {
              message =
                "Failed to load Flink artifacts. Please check your connection and try again.";
              showNotification = true;
              logError(error, "Failed to load Flink artifacts");
            }

            if (showNotification) {
              void showErrorNotificationWithButtons(message);
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
