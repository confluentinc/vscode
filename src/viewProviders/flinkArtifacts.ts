import { Disposable } from "vscode";
import { ContextValues } from "../context/values";
import {
  artifactUploadCompleted,
  currentFlinkArtifactsPoolChanged,
  flinkArtifactUDFViewMode,
} from "../emitters";
import { logError } from "../errors";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkUdf } from "../models/flinkUDF";
import { showErrorNotificationWithButtons } from "../notifications";
import { MultiModeViewProvider, ViewProviderDelegate } from "./baseModels/multiViewBase";
import { FlinkArtifactsViewProviderMode } from "./multiViewDelegates/constants";
import { FlinkArtifactsDelegate } from "./multiViewDelegates/flinkArtifactsDelegate";
import { FlinkUDFsDelegate } from "./multiViewDelegates/flinkUDFsDelegate";

export type ArtifactOrUdf = FlinkArtifact | FlinkUdf;

/**
 * Multi-mode view provider for Flink artifacts and UDFs.
 * - When set to the "artifacts" mode, logic is delegated to the {@link FlinkArtifactsDelegate}.
 * - When set to the "udfs" mode, logic is delegated to the {@link FlinkUDFsDelegate}.
 */
export class FlinkArtifactsUDFsViewProvider extends MultiModeViewProvider<
  FlinkArtifactsViewProviderMode,
  CCloudFlinkComputePool,
  ArtifactOrUdf
> {
  viewId = "confluent-flink-artifacts";

  parentResourceChangedEmitter = currentFlinkArtifactsPoolChanged;
  parentResourceChangedContextValue = ContextValues.flinkArtifactsPoolSelected;

  children: ArtifactOrUdf[] = [];

  constructor() {
    super();
    // pass the main provider into each mode so they can call its helpers without needing to extend
    // the provider itself and causing circular dependencies / stack overflows
    const artifactsDelegate = new FlinkArtifactsDelegate();
    const udfsDelegate = new FlinkUDFsDelegate();

    this.treeViewDelegates = new Map<
      FlinkArtifactsViewProviderMode,
      ViewProviderDelegate<FlinkArtifactsViewProviderMode, CCloudFlinkComputePool, ArtifactOrUdf>
    >([
      [FlinkArtifactsViewProviderMode.Artifacts, artifactsDelegate],
      [FlinkArtifactsViewProviderMode.UDFs, udfsDelegate],
    ]);

    this.defaultDelegate = artifactsDelegate;
    this.currentDelegate = this.defaultDelegate;
  }

  setCustomEventListeners(): Disposable[] {
    return [
      flinkArtifactUDFViewMode.event(this.switchMode.bind(this)),
      artifactUploadCompleted.event(this.artifactUploadCompletedHandler.bind(this)),
    ];
  }
  private async artifactUploadCompletedHandler(): Promise<void> {
    if (this.currentDelegate.mode === FlinkArtifactsViewProviderMode.Artifacts) {
      await this.refresh();
    }
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
            this.children = await this.currentDelegate.fetchChildren(this.computePool!);
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
