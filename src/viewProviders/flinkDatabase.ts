import { Disposable } from "vscode";
import { ContextValues } from "../context/values";
import {
  artifactsChanged,
  flinkDatabaseViewMode,
  flinkDatabaseViewResourceChanged,
  udfsChanged,
} from "../emitters";
import { logError } from "../errors";
import { FlinkArtifact } from "../models/flinkArtifact";
import { FlinkUdf } from "../models/flinkUDF";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { IEnvProviderRegion } from "../models/resource";
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

  private readonly artifactsDelegate = new FlinkArtifactsDelegate();
  private readonly udfsDelegate = new FlinkUDFsDelegate();

  treeViewDelegates = new Map<
    FlinkDatabaseViewProviderMode,
    ViewProviderDelegate<FlinkDatabaseViewProviderMode, CCloudFlinkDbKafkaCluster, ArtifactOrUdf>
  >([
    [FlinkDatabaseViewProviderMode.Artifacts, this.artifactsDelegate],
    [FlinkDatabaseViewProviderMode.UDFs, this.udfsDelegate],
  ]);

  constructor() {
    super();

    // Start in artifacts mode by default.
    this.defaultDelegate = this.artifactsDelegate;
    this.currentDelegate = this.defaultDelegate;
  }

  setCustomEventListeners(): Disposable[] {
    return [
      flinkDatabaseViewMode.event(this.switchMode.bind(this)),
      artifactsChanged.event(this.artifactsChangedHandler.bind(this)),
      udfsChanged.event(this.udfsChangedHandler.bind(this)),
    ];
  }

  /**
   * The list of artifacts in the given env/provider/region has just changed.
   * If it matches our current database, we may need to refresh.
   **/
  async artifactsChangedHandler(envRegion: IEnvProviderRegion): Promise<void> {
    // if the artifacts changed in the env/provider/region of our current database, take action!
    if (this.database?.isSameEnvCloudRegion(envRegion)) {
      if (this.currentDelegate.mode === FlinkDatabaseViewProviderMode.Artifacts) {
        // We're in artifacts mode, so deep fetch that delegate's children + repaint now.
        await this.refresh(true);
      } else {
        // Not viewing artifacts right this second, but we're the entity responsible for cache busting
        // in response to this event.
        // Tell the artifacts delegate to preemptively refresh its cache for next time we switch to it

        await this.artifactsDelegate.fetchChildren(this.database, true);
      }
    }
  }

  /**
   * The list of UDFs in the given Flink database has just changed.
   * If it matches our current database, we may need to refresh.
   **/
  async udfsChangedHandler(dbWithUpdatedUdfs: CCloudFlinkDbKafkaCluster): Promise<void> {
    if (this.database && this.database.id === dbWithUpdatedUdfs.id) {
      if (this.currentDelegate.mode === FlinkDatabaseViewProviderMode.UDFs) {
        // Currently viewing UDFs: deep refresh now.
        await this.refresh(true);
      } else {
        // Not in UDFs mode: preemptively refresh the UDFs delegate cache.
        await this.udfsDelegate.fetchChildren(this.database, true);
      }
    }
  }

  async refresh(forceDeepRefresh: boolean = false): Promise<void> {
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
            this.children = await this.currentDelegate.fetchChildren(db, forceDeepRefresh);
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
