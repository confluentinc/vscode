import { TreeItem } from "vscode";
import { isResponseError, logError } from "../../errors";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../../models/flinkArtifact";
import { showErrorNotificationWithButtons } from "../../notifications";
import { ViewProviderDelegate } from "../baseModels/multiViewBase";
import { type FlinkArtifactsUDFsViewProvider } from "../flinkArtifacts";
import { FlinkArtifactsViewProviderMode } from "./constants";

export class FlinkArtifactsDelegate extends ViewProviderDelegate<
  FlinkArtifactsViewProviderMode,
  FlinkArtifact
> {
  readonly mode = FlinkArtifactsViewProviderMode.Artifacts;
  readonly viewTitle = "Flink Artifacts (Preview)";

  children: FlinkArtifact[] = [];

  loadingMessage = "Loading Flink artifacts...";

  constructor(readonly parent: FlinkArtifactsUDFsViewProvider) {
    super();
  }

  async fetchChildren(): Promise<FlinkArtifact[]> {
    this.children = [];
    try {
      const loader = CCloudResourceLoader.getInstance();
      this.children = await loader.getFlinkArtifacts(this.parent.computePool!);
      return this.children;
    } catch (error) {
      const { showNotification, message } = triageGetFlinkArtifactsError(error, this.parent.logger);
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

export function triageGetFlinkArtifactsError(
  error: unknown,
  logger: { debug: (msg: string, err: unknown) => void },
): {
  showNotification: boolean;
  message: string;
} {
  let showNotification = false;
  let message = "Failed to load Flink artifacts.";

  if (isResponseError(error)) {
    const status = error.response.status;
    error.response
      .clone()
      .json()
      .catch((err) => {
        logger.debug("Failed to parse error response as JSON", err);
      });
    /* Note: This switch statement intentionally excludes 400 errors.
     Otherwise, they may pop up on loading the compute pool if it is using an unsupported cloud provider. */
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
