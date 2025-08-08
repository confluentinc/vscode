import { Disposable, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { currentFlinkArtifactsPoolChanged, flinkArtifactUDFViewMode } from "../emitters";
import { isResponseError, logError } from "../errors";
import { CCloudResourceLoader } from "../loaders";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkUdf, FlinkUdfTreeItem } from "../models/flinkUDF";
import { showErrorNotificationWithButtons } from "../notifications";
import { MultiModeViewProvider, ViewProviderDelegate } from "./baseModels/multiViewBase";

export enum FlinkArtifactsViewProviderMode {
  Artifacts = "artifacts",
  UDFs = "UDFs",
}

/** Multi-mode view provider for Flink artifacts and UDFs. */
export class FlinkArtifactsUDFsViewProvider extends MultiModeViewProvider<
  FlinkArtifactsViewProviderMode,
  CCloudFlinkComputePool,
  FlinkArtifact | FlinkUdf
> {
  viewId = "confluent-flink-artifacts";

  parentResourceChangedEmitter = currentFlinkArtifactsPoolChanged;
  parentResourceChangedContextValue = ContextValues.flinkArtifactsPoolSelected;

  children: (FlinkArtifact | FlinkUdf)[] = [];

  constructor() {
    super();
    // pass the main provider into each mode so they can call its helpers without needing to extend
    // the provider itself and causing circular dependencies / stack overflows
    const artifactsDelegate = new FlinkArtifactsDelegate(this);
    const udfsDelegate = new FlinkUDFsDelegate(this);
    this.treeViewDelegates = new Map<
      FlinkArtifactsViewProviderMode,
      ViewProviderDelegate<FlinkArtifactsViewProviderMode, FlinkArtifact | FlinkUdf>
    >([
      [FlinkArtifactsViewProviderMode.Artifacts, artifactsDelegate],
      [FlinkArtifactsViewProviderMode.UDFs, udfsDelegate],
    ]);
    this.defaultDelegate = artifactsDelegate;
    this.currentDelegate = this.defaultDelegate;
  }

  setCustomEventListeners(): Disposable[] {
    return [flinkArtifactUDFViewMode.event(this.switchMode.bind(this))];
  }

  async refresh(): Promise<void> {
    this.children = [];

    if (this.computePool) {
      // clear out the current delegate's children
      this._onDidChangeTreeData.fire();

      await this.withProgress(
        this.currentDelegate.loadingMessage,
        async () => {
          try {
            this.children = await this.currentDelegate.fetchChildren();
          } catch (error) {
            const msg = `Failed to load Flink ${this.currentDelegate.mode}`;
            void logError(error, msg);
            void showErrorNotificationWithButtons(msg);
          }
        },
        false,
      );
    }

    // either show the empty state or the current delegate's children
    this._onDidChangeTreeData.fire();
  }

  get loggerName() {
    return `viewProviders.flink.${this.currentDelegate?.mode ?? "unknown"}`;
  }

  get kind() {
    return this.currentDelegate?.mode ?? "unknown";
  }

  get computePool(): CCloudFlinkComputePool | null {
    return this.resource;
  }
}

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
