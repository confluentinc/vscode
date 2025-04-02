import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { BaseViewProvider } from "./base";

export class FlinkStatementsViewProvider
  extends BaseViewProvider<FlinkStatement>
  implements TreeDataProvider<FlinkStatement>
{
  viewId = "confluent-flink-statements";

  private static instance: FlinkStatementsViewProvider;

  async getChildren(): Promise<FlinkStatement[]> {
    return [];
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new TreeItem(element.name);
  }

  setEventListeners(): Disposable[] {
    return [];
  }
}
