import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ContextValues, setContextValue } from "../context/values";
import { currentFlinkStatementsPoolChanged } from "../emitters";
import { Logger } from "../logging";
import { FlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { EnvironmentId } from "../models/resource";
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

    // TODO: replace this with real data
    const fakeStatement = new FlinkStatement({
      connectionId: CCLOUD_CONNECTION_ID,
      connectionType: ConnectionType.Ccloud,
      environmentId: "env1" as EnvironmentId,
      computePoolId: "pool1",
      name: "statement1",
      status: "running",
    });
    children.push(
      fakeStatement,
      new FlinkStatement({
        ...fakeStatement,
        name: "statement2",
        status: "failed",
      }),
      new FlinkStatement({
        ...fakeStatement,
        name: "statement3",
        status: "stopped",
      }),
    );

    return this.filterChildren(undefined, children);
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new FlinkStatementTreeItem(element);
  }

  setEventListeners(): Disposable[] {
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
    return [poolChangedSub];
  }

  async reset() {
    logger.debug("resetting view");
    setContextValue(ContextValues.flinkStatementsPoolSelected, false);
    this.resource = null;
    await this.updateTreeViewDescription();
  }

  get computePool(): FlinkComputePool | null {
    return this.resource;
  }
}
