import { TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { currentFlinkStatementsResourceChanged } from "../emitters";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { BaseViewProvider } from "./base";

/**
 * View controller for Flink statements. Can be assigned to track either
 * a single compute cluster, or a CCloud environment.
 *
 * If set to a CCloud environment, will show all of the statements
 * across all of the provider+region pairs that we find Flinkable
 * within the environment. See {@link CCloudResourceLoader.getFlinkStatements} for
 * the specifics.
 *
 * */
export class FlinkStatementsViewProvider
  extends BaseViewProvider<CCloudFlinkComputePool | CCloudEnvironment, FlinkStatement>
  implements TreeDataProvider<FlinkStatement>
{
  loggerName = "viewProviders.flinkStatements";
  viewId = "confluent-flink-statements";

  parentResourceChangedEmitter = currentFlinkStatementsResourceChanged;
  parentResourceChangedContextValue = ContextValues.flinkStatementsPoolSelected;

  searchContextValue = ContextValues.flinkStatementsSearchApplied;

  // Map of resource id string -> resource currently in the tree view.
  private resourcesInTreeView: Map<string, FlinkStatement> = new Map();

  /**
   * (Re)paint the view. If forceDeepRefresh=true, then will force a deep fetch of the statements.
   */
  refresh(): void {
    // Out with any existing subjects.
    this.resourcesInTreeView.clear();

    if (this.resource !== null) {
      const loader = ResourceLoader.getInstance(this.resource.connectionId) as CCloudResourceLoader;

      void this.withProgress(
        "Loading Flink statements...",
        async () => {
          // Fetch statements, remember them, and indicate to the view that we have new data.
          const statements = await loader.getFlinkStatements(this.resource!);
          statements.forEach((r: FlinkStatement) => this.resourcesInTreeView.set(r.id, r));
          this._onDidChangeTreeData.fire();
        },
        false,
      );
    }

    // Inform view that toplevel items have changed (because of edging
    // from having old contents to new empty state). When loading is completed inside
    // the withProgress, we will fire _onDidChangeTreeData again to update the view.
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
    if (this.resource instanceof CCloudFlinkComputePool) {
      return this.resource;
    }

    // if either focused on an entire environement or nothing at all, return null.
    return null;
  }
}
