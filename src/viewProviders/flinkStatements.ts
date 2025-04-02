import { TreeDataProvider, TreeItem } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ContextValues } from "../context/values";
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
  loggerName = "viewProviders.flinkStatements";
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
      id: "statement1",
      status: "running",
    });
    children.push(
      fakeStatement,
      new FlinkStatement({
        ...fakeStatement,
        id: "statement2",
        status: "failed",
      }),
      new FlinkStatement({
        ...fakeStatement,
        id: "statement3",
        status: "stopped",
      }),
    );

    return this.filterChildren(undefined, children);
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new FlinkStatementTreeItem(element);
  }

  get computePool(): FlinkComputePool | null {
    return this.resource;
  }
}
