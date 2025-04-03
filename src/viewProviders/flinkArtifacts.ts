import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ContextValues, setContextValue } from "../context/values";
import { ccloudConnected, currentFlinkArtifactsPoolChanged } from "../emitters";
import { Logger } from "../logging";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { CCloudFlinkComputePool, FlinkComputePool } from "../models/flinkComputePool";
import { isCCloud } from "../models/resource";
import { BaseViewProvider } from "./base";

const logger = new Logger("viewProviders.flinkArtifacts");

export class FlinkArtifactsViewProvider
  extends BaseViewProvider<FlinkComputePool, FlinkArtifact>
  implements TreeDataProvider<FlinkArtifact>
{
  viewId = "confluent-flink-artifacts";
  searchContextValue = ContextValues.flinkArtifactsSearchApplied;

  async getChildren(): Promise<FlinkArtifact[]> {
    const children: FlinkArtifact[] = [];
    if (!this.computePool) {
      return children;
    }

    const pool: CCloudFlinkComputePool = this.computePool as CCloudFlinkComputePool;

    // TODO: replace this with real data
    const numArtifacts = Math.floor(Math.random() * 10) + 1;
    for (let i = 0; i < numArtifacts; i++) {
      const fakeArtifact = new FlinkArtifact({
        connectionId: pool.connectionId,
        connectionType: pool.connectionType,
        environmentId: pool.environmentId,
        computePoolId: pool.id,
        name: `artifact${i + 1}-${pool.name}`,
        description: `Test artifact #${i + 1}`,
        provider: pool.provider,
        region: pool.region,
      });
      children.push(fakeArtifact);
    }

    return this.filterChildren(undefined, children);
  }

  getTreeItem(element: FlinkArtifact): TreeItem {
    return new FlinkArtifactTreeItem(element);
  }

  setEventListeners(): Disposable[] {
    // no environmentChanged listener since we don't support direct connections, and we don't have
    // any other environment-changing events for Flink

    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      if (this.computePool && isCCloud(this.computePool)) {
        // any transition of CCloud connection state should reset the tree view if we're focused on
        // a CCloud Flink compute pool
        logger.debug("ccloudConnected event fired, resetting view", { connected });
        this.reset();
      }
    });

    const poolChangedSub: Disposable = currentFlinkArtifactsPoolChanged.event(
      async (pool: FlinkComputePool | null) => {
        logger.debug(
          `currentFlinkArtifactsPool event fired, ${pool ? "refreshing" : "resetting"}.`,
          { pool },
        );
        this.setSearch(null); // reset search when pool changes
        if (!pool) {
          this.reset();
        } else {
          setContextValue(ContextValues.flinkArtifactsPoolSelected, true);
          this.resource = pool;
          await this.updateTreeViewDescription();
          this.refresh();
        }
      },
    );
    return [ccloudConnectedSub, poolChangedSub];
  }

  async reset() {
    logger.debug("resetting view");
    setContextValue(ContextValues.flinkArtifactsPoolSelected, false);
    this.resource = null;
    await this.updateTreeViewDescription();
    this.refresh();
  }

  get computePool(): FlinkComputePool | null {
    return this.resource;
  }
}
