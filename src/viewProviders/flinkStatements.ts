import { TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { currentFlinkStatementsPoolChanged } from "../emitters";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { BaseViewProvider } from "./base";

export class FlinkStatementsViewProvider
  extends BaseViewProvider<CCloudFlinkComputePool, FlinkStatement>
  implements TreeDataProvider<FlinkStatement>
{
  loggerName = "viewProviders.flinkStatements";
  viewId = "confluent-flink-statements";

  parentResourceChangedEmitter = currentFlinkStatementsPoolChanged;
  parentResourceChangedContextValue = ContextValues.flinkStatementsPoolSelected;

  searchContextValue = ContextValues.flinkStatementsSearchApplied;

  // Map of resource id string -> resource currently in the tree view.
  private resourcesInTreeView: Map<string, FlinkStatement> = new Map();

  /**
   * (Re)paint the view. If forceDeepRefresh=true, then will force a deep fetch of the statements.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refresh(forceDeepRefresh: boolean = false): Promise<void> {
    // Out with any existing subjects.
    this.resourcesInTreeView.clear();

    if (this.resource !== null) {
      const loader = ResourceLoader.getInstance(this.resource.connectionId) as CCloudResourceLoader;

      // Fetch statements using the loader, pushing down need to do deep refresh.
      const statements: FlinkStatement[] = await loader.getFlinkStatements(this.resource);

      // Repopulate this.subjectsInTreeView from getSubjects() result.
      statements.forEach((r: FlinkStatement) => this.resourcesInTreeView.set(r.id, r));
    }

    // Indicate to view that toplevel items have changed.
    this._onDidChangeTreeData.fire();
  }

  async getChildren(): Promise<FlinkStatement[]> {
    const children: FlinkStatement[] = Array.from(this.resourcesInTreeView.values());

    return this.filterChildren(undefined, children);
  }

  getTreeItem(element: FlinkStatement): TreeItem {
    return new FlinkStatementTreeItem(element);
  }

  get computePool(): CCloudFlinkComputePool | null {
    return this.resource;
  }
}
