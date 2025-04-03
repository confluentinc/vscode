import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ContextValues, setContextValue } from "../context/values";
import { ccloudConnected, currentFlinkStatementsPoolChanged } from "../emitters";
import { Logger } from "../logging";
import { CCloudFlinkComputePool, FlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { isCCloud } from "../models/resource";
import { BaseViewProvider } from "./base";

const logger = new Logger("viewProviders.flinkStatements");

export class FlinkStatementsViewProvider
  extends BaseViewProvider<FlinkComputePool, FlinkStatement>
  implements TreeDataProvider<FlinkStatement>
{
  viewId = "confluent-flink-statements";
  searchContextValue = ContextValues.flinkStatementsSearchApplied;

  async getChildren(): Promise<FlinkStatement[]> {
    const children: FlinkStatement[] = [];
    if (!this.computePool) {
      return children;
    }

    const pool: CCloudFlinkComputePool = this.computePool as CCloudFlinkComputePool;

    // TODO: replace this with real data
    const numStatements = Math.floor(Math.random() * 20) + 1;
    const possibleStatuses = [
      "RUNNING",
      "CANCELLING",
      "CANCELED",
      "FAILED",
      "FINISHED",
      "CREATED",
      "RESTARTING",
      "SUSPENDED",
    ];
    for (let i = 0; i < numStatements; i++) {
      const fakeArtifact = new FlinkStatement({
        connectionId: pool.connectionId,
        connectionType: pool.connectionType,
        environmentId: pool.environmentId,
        computePoolId: pool.id,
        name: `statement${i + 1}-${pool.name}`,
        status: possibleStatuses[Math.floor(Math.random() * possibleStatuses.length)].toLowerCase(),
      });
      children.push(fakeArtifact);
    }

    return this.filterChildren(undefined, children);
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new FlinkStatementTreeItem(element);
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

    const poolChangedSub: Disposable = currentFlinkStatementsPoolChanged.event(
      async (pool: FlinkComputePool | null) => {
        logger.debug(
          `currentFlinkStatementsPool event fired, ${pool ? "refreshing" : "resetting"}.`,
          { pool },
        );
        this.setSearch(null); // reset search when pool changes
        if (!pool) {
          this.reset();
        } else {
          setContextValue(ContextValues.flinkStatementsPoolSelected, true);
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
    setContextValue(ContextValues.flinkStatementsPoolSelected, false);
    this.resource = null;
    await this.updateTreeViewDescription();
    this.refresh();
  }

  get computePool(): FlinkComputePool | null {
    return this.resource;
  }
}
