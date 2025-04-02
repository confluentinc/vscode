import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { EnvironmentId } from "../models/resource";
import { BaseViewProvider } from "./base";

export class FlinkStatementsViewProvider
  extends BaseViewProvider<FlinkStatement>
  implements TreeDataProvider<FlinkStatement>
{
  viewId = "confluent-flink-statements";

  async getChildren(): Promise<FlinkStatement[]> {
    const children: FlinkStatement[] = [];

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
    return [];
  }
}
