import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ContextValues, setContextValue } from "../context/values";
import { currentFlinkArtifactsPoolChanged } from "../emitters";
import { Logger } from "../logging";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { FlinkComputePool } from "../models/flinkComputePool";
import { EnvironmentId } from "../models/resource";
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

    // TODO: replace this with real data
    const fakeArtifact = new FlinkArtifact({
      connectionId: CCLOUD_CONNECTION_ID,
      connectionType: ConnectionType.Ccloud,
      environmentId: "env1" as EnvironmentId,
      computePoolId: "pool1",
      name: "artifact1",
      description: "This is a test artifact",
      provider: "aws",
      region: "us-west-2",
    });
    children.push(
      fakeArtifact,
      new FlinkArtifact({
        ...fakeArtifact,
        name: "artifact2",
        description: "Best test UDF ever",
      }),
    );

    return this.filterChildren(undefined, children);
  }

  getTreeItem(element: FlinkArtifact): TreeItem {
    return new FlinkArtifactTreeItem(element);
  }

  setEventListeners(): Disposable[] {
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
    return [poolChangedSub];
  }

  async reset() {
    logger.debug("resetting view");
    setContextValue(ContextValues.flinkArtifactsPoolSelected, false);
    this.resource = null;
    await this.updateTreeViewDescription();
  }

  get computePool(): FlinkComputePool | null {
    return this.resource;
  }
}
