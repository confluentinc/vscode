import { TreeItem } from "vscode";
import { extractResponseBody, isResponseError, logError } from "../../errors";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../../models/flinkArtifact";
import { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { showErrorNotificationWithButtons } from "../../notifications";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./constants";

export class FlinkArtifactsDelegate extends ViewProviderDelegate<
  FlinkDatabaseViewProviderMode,
  CCloudFlinkDbKafkaCluster,
  FlinkArtifact
> {
  readonly mode = FlinkDatabaseViewProviderMode.Artifacts;
  readonly viewTitle = "Flink Artifacts (Preview)";
  readonly loadingMessage = "Loading Flink artifacts...";

  async fetchChildren(
    resource: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkArtifact[]> {
    this.children = [];
    try {
      const loader = CCloudResourceLoader.getInstance();
      this.children = await loader.getFlinkArtifacts(resource, forceDeepRefresh);
      return this.children;
    } catch (error) {
      const { showNotification, message } = await triageGetFlinkArtifactsError(error);
      if (showNotification) {
        void showErrorNotificationWithButtons(message);
      }
      throw error;
    }
  }

  getTreeItem(element: FlinkArtifact): TreeItem {
    return new FlinkArtifactTreeItem(element);
  }
}

export async function triageGetFlinkArtifactsError(error: unknown): Promise<{
  showNotification: boolean;
  message: string;
}> {
  let showNotification = false;
  let message = "Failed to load Flink artifacts.";

  if (isResponseError(error)) {
    const status = error.response.status;
    const body = await extractResponseBody(error);
    if (status === 400) {
      showNotification = true;
      if (body.errors[0].detail)
        message = `Bad request: ${body.errors[0].detail}`; // expect errors w/ specific detail for 400s
      // but just in case...
      else
        message =
          "Bad request when loading Flink artifacts. Please ensure your compute pool is configured correctly.";
      return { showNotification, message };
    }
    if (status >= 401 && status < 600) {
      showNotification = true;
      switch (status) {
        case 401:
          message = "Authentication required to load Flink artifacts.";
          break;
        case 403:
          message = "Failed to load Flink artifacts. Please check your permissions and try again.";
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
    void logError(error, "Failed to load Flink artifacts");
  } else {
    message = "Failed to load Flink artifacts. Please check your connection and try again.";
    showNotification = true;
    void logError(error, "Failed to load Flink artifacts");
  }

  return { showNotification, message };
}
