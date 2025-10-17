import type { Disposable } from "vscode";
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ContextValues } from "../context/values";
import {
  artifactsChanged,
  flinkDatabaseViewMode,
  flinkDatabaseViewResourceChanged,
  flinkDatabaseViewSearchSet,
  udfsChanged,
} from "../emitters";
import { logError } from "../errors";
import { ResourceLoader } from "../loaders";
import type { FlinkArtifact } from "../models/flinkArtifact";
import type { FlinkUdf } from "../models/flinkUDF";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import type { IEnvProviderRegion } from "../models/resource";
import { showErrorNotificationWithButtons } from "../notifications";
import type { ViewProviderDelegate } from "./baseModels/multiViewBase";
import { MultiModeViewProvider } from "./baseModels/multiViewBase";
import { FlinkDatabaseViewProviderMode } from "./multiViewDelegates/constants";
import {
  FlinkArtifactsDelegate,
  getFlinkArtifactsErrorMessage,
} from "./multiViewDelegates/flinkArtifactsDelegate";
import { FlinkUDFsDelegate } from "./multiViewDelegates/flinkUDFsDelegate";

/** The row models used as view children */
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
  kind = "flinkdatabase";

  parentResourceChangedEmitter = flinkDatabaseViewResourceChanged;
  parentResourceChangedContextValue = ContextValues.flinkDatabaseSelected;

  searchChangedEmitter = flinkDatabaseViewSearchSet;
  searchContextValue = ContextValues.flinkDatabaseSearchApplied;

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

    // Start in UDFs mode by default.
    this.defaultDelegate = this.udfsDelegate;
    this.currentDelegate = this.defaultDelegate;
  }

  setCustomEventListeners(): Disposable[] {
    return [
      flinkDatabaseViewMode.event(this.switchMode.bind(this)),
      artifactsChanged.event(this.artifactsChangedHandler.bind(this)),
      udfsChanged.event(this.udfsChangedHandler.bind(this)),
    ];
  }

  override getChildren(element?: ArtifactOrUdf): any[] {
    const children = super.getChildren(element);

    // retrieve if there are artifacts but no UDFs to show the info message in UDFs mode.
    if (
      !element &&
      this.currentDelegate.mode === FlinkDatabaseViewProviderMode.UDFs &&
      children.length === 0 &&
      this.artifactsDelegate.children.length > 0
    ) {
      return [{ _isInfo: true, _count: this.artifactsDelegate.children.length }];
    }

    return children;
  }

  override getTreeItem(element: any): TreeItem {
    // default info message when there are artifacts but no UDFs.
    if (element._isInfo) {
      const item = new TreeItem(
        `Found ${element._count} uploaded artifact${element._count > 1 ? "s" : ""}`,
        TreeItemCollapsibleState.None,
      );
      item.description = "Switch to Flink Artifacts to register UDFs";
      item.command = { command: "confluent.flinkdatabase.setArtifactsViewMode", title: "" };
      item.iconPath = new ThemeIcon("info");
      item.tooltip = "Click to switch to Flink Artifacts view";
      return item;
    }

    return super.getTreeItem(element);
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
            if (this.currentDelegate.mode === FlinkDatabaseViewProviderMode.UDFs) {
              this.children = await this.currentDelegate.fetchChildren(db, forceDeepRefresh);
              // If no UDFs found, fetch artifacts to show info message to register UDFs.
              if (this.children.length === 0) {
                await this.artifactsDelegate.fetchChildren(db, forceDeepRefresh);
              }
            } else {
              this.children = await this.currentDelegate.fetchChildren(db, forceDeepRefresh);
            }
          } catch (error) {
            let msg = `Failed to load Flink ${this.currentDelegate.mode}`;
            if (this.currentDelegate.mode === FlinkDatabaseViewProviderMode.Artifacts) {
              msg = await getFlinkArtifactsErrorMessage(error);
            }
            void showErrorNotificationWithButtons(msg);
            logError(error, msg);
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

  get database(): CCloudFlinkDbKafkaCluster | null {
    return this.resource;
  }

  /** Update the tree view description to show the currently-focused Flink Database's parent env
   * name and the Flink Database name. */
  async updateTreeViewDescription(): Promise<void> {
    const db = this.database;
    if (!db) {
      this.treeView.description = "";
      return;
    }
    const env = await ResourceLoader.getEnvironment(db.connectionId, db.environmentId);
    if (env) {
      this.treeView.description = `${env.name} | ${db.name}`;
    } else {
      this.treeView.description = db.name;
    }
  }
}
