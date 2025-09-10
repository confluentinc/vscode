import { Disposable } from "vscode";
import { ContextValues } from "../context/values";
import {
  artifactUploadCompleted,
  artifactUploadDeleted,
  flinkDatabaseViewMode,
  flinkDatabaseViewResourceChanged,
} from "../emitters";
import { logError } from "../errors";
import { FlinkArtifact } from "../models/flinkArtifact";
import { FlinkUdf } from "../models/flinkUDF";
import { CCloudFlinkDbKafkaCluster, CCloudKafkaCluster } from "../models/kafkaCluster";
import { showErrorNotificationWithButtons } from "../notifications";
import { MultiModeViewProvider, ViewProviderDelegate } from "./baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./multiViewDelegates/constants";
import { FlinkArtifactsDelegate } from "./multiViewDelegates/flinkArtifactsDelegate";
import { FlinkUDFsDelegate } from "./multiViewDelegates/flinkUDFsDelegate";

export type ArtifactOrUdf = FlinkArtifact | FlinkUdf;

/**
 * Multi-mode view provider for Flink artifacts and UDFs.
 * - When set to the "artifacts" mode, logic is delegated to the {@link FlinkArtifactsDelegate}.
 * - When set to the "udfs" mode, logic is delegated to the {@link FlinkUDFsDelegate}.
 *
 * The parent resource is a "Flinkable" CCloud Kafka cluster, which we refer to as a "Flink Database".
 */
export class FlinkDatabaseViewProvider extends MultiModeViewProvider<
  FlinkDatabaseViewProviderMode,
  CCloudFlinkDbKafkaCluster,
  ArtifactOrUdf
> {
  viewId = "confluent-flink-database";

  parentResourceChangedEmitter = flinkDatabaseViewResourceChanged;
  parentResourceChangedContextValue = ContextValues.flinkDatabaseSelected;

  children: ArtifactOrUdf[] = [];

  constructor() {
    super();
    // pass the main provider into each mode so they can call its helpers without needing to extend
    // the provider itself and causing circular dependencies / stack overflows
    const artifactsDelegate = new FlinkArtifactsDelegate();
    const udfsDelegate = new FlinkUDFsDelegate();

    this.treeViewDelegates = new Map<
      FlinkDatabaseViewProviderMode,
      ViewProviderDelegate<FlinkDatabaseViewProviderMode, CCloudKafkaCluster, ArtifactOrUdf>
    >([
      [FlinkDatabaseViewProviderMode.Artifacts, artifactsDelegate],
      [FlinkDatabaseViewProviderMode.UDFs, udfsDelegate],
    ]);

    this.defaultDelegate = artifactsDelegate;
    this.currentDelegate = this.defaultDelegate;
  }

  setCustomEventListeners(): Disposable[] {
    return [
      flinkDatabaseViewMode.event(this.switchMode.bind(this)),
      artifactUploadDeleted.event(this.artifactsChangedHandler.bind(this)),
      artifactUploadCompleted.event(this.artifactsChangedHandler.bind(this)),
    ];
  }

  private async artifactsChangedHandler(): Promise<void> {
    if (this.currentDelegate.mode === FlinkDatabaseViewProviderMode.Artifacts) {
      await this.refresh();
    }
  }

  async refresh(): Promise<void> {
    this.children = [];

    if (this.database) {
      // Capture the database in a local variable so that will never change
      // while we're in the middle of this async operation.
      const db = this.database;

      this.logger.debug(`refreshing Flink Database view for ${db.name} (${db.id})`);
      // clear out the current delegate's children
      this._onDidChangeTreeData.fire();

      await this.withProgress(
        this.currentDelegate.loadingMessage,
        async () => {
          try {
            this.children = await this.currentDelegate.fetchChildren(db);
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

  get database(): CCloudFlinkDbKafkaCluster | null {
    return this.resource;
  }
}
