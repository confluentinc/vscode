import { TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { currentFlinkArtifactsPoolChanged } from "../emitters";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { BaseViewProvider } from "./base";

export class FlinkArtifactsViewProvider
  extends BaseViewProvider<CCloudFlinkComputePool, FlinkArtifact>
  implements TreeDataProvider<FlinkArtifact>
{
  loggerName = "viewProviders.flinkArtifacts";
  viewId = "confluent-flink-artifacts";

  parentResourceChangedEmitter = currentFlinkArtifactsPoolChanged;
  parentResourceChangedContextValue = ContextValues.flinkArtifactsPoolSelected;

  searchContextValue = ContextValues.flinkArtifactsSearchApplied;

  async getChildren(): Promise<FlinkArtifact[]> {
    const children: FlinkArtifact[] = [];
    if (!this.computePool) {
      return children;
    }

    const pool: CCloudFlinkComputePool = this.computePool as CCloudFlinkComputePool;

    // TODO: replace this with real data -- this should not require any pool-specific filtering,
    // but use the environment, provider, and region from the pool
    const numArtifacts = Math.floor(Math.random() * 10) + 1;
    for (let i = 0; i < numArtifacts; i++) {
      const fakeArtifact = new FlinkArtifact({
        connectionId: pool.connectionId,
        connectionType: pool.connectionType,
        environmentId: pool.environmentId,
        id: `artifact${i + 1}`,
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

  get computePool(): CCloudFlinkComputePool | null {
    return this.resource;
  }
}
