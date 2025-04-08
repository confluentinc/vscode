import { TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { currentFlinkStatementsPoolChanged } from "../emitters";
import { CCloudFlinkComputePool, FlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { BaseViewProvider } from "./base";

export class FlinkStatementsViewProvider
  extends BaseViewProvider<FlinkComputePool, FlinkStatement>
  implements TreeDataProvider<FlinkStatement>
{
  loggerName = "viewProviders.flinkStatements";
  viewId = "confluent-flink-statements";

  parentResourceChangedEmitter = currentFlinkStatementsPoolChanged;
  parentResourceChangedContextValue = ContextValues.flinkStatementsPoolSelected;

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
      "COMPLETED",
      "DEGRADED", // in CCloud, not the spec
      "DELETING",
      "FAILED",
      "FAILING",
      "PENDING",
      "RUNNING",
      "STOPPED",
      "STOPPING", // in CCloud, not the spec
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

  get computePool(): FlinkComputePool | null {
    return this.resource;
  }
}
