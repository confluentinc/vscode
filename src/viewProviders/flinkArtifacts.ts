import { TreeDataProvider, TreeItem } from "vscode";
import { ContextValues, setContextValue } from "../context/values";
import { currentFlinkArtifactsPoolChanged } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement } from "../models/flinkStatement";
import { ParentedBaseViewProvider } from "./base";

type FlinkUnifiedItem = FlinkStatement | FlinkArtifact;

enum ViewMode {
  Statements = "statements",
  Artifacts = "artifacts",
}
export class FlinkArtifactsViewProvider
  extends ParentedBaseViewProvider<CCloudFlinkComputePool, FlinkUnifiedItem>
  implements TreeDataProvider<FlinkUnifiedItem>
{
  readonly kind = "flinkArtifacts";
  loggerName = "viewProviders.flinkArtifacts";
  viewId = "confluent-flink-artifacts";

  // TODO update context values for new unified view
  parentResourceChangedEmitter = currentFlinkArtifactsPoolChanged;
  parentResourceChangedContextValue = ContextValues.flinkArtifactsPoolSelected;

  private _viewMode: ViewMode = ViewMode.Statements;
  private _statements: FlinkStatement[] = [];
  private _artifacts: FlinkArtifact[] = [];

  get viewMode(): ViewMode {
    return this._viewMode;
  }
  async setViewMode(mode: ViewMode): Promise<void> {
    if (this._viewMode === mode) {
      return;
    }

    this.logger.debug(`Switching view mode from ${this._viewMode} to ${mode}`);
    this._viewMode = mode;

    this.treeView.title = `Flink ${mode === ViewMode.Statements ? "Statements" : "Artifacts"}`;

    await this.refresh();
  }

  getChildren(element?: FlinkUnifiedItem): FlinkUnifiedItem[] {
    let children: FlinkUnifiedItem[];

    if (this._viewMode === ViewMode.Statements) {
      children = [...this._statements];
    } else {
      children = [...this._artifacts];
    }

    return this.filterChildren(element, children);
  }

  async refresh(): Promise<void> {
    this.logger.debug(`Refreshing Flink ${this._viewMode} view`);
    this._artifacts = [];
    this._statements = [];

    let itemName = this._viewMode === ViewMode.Statements ? "statements" : "artifacts";
    if (this.computePool) {
      // Immediately inform the view that we (temporarily) have no data so it will clear.
      this._onDidChangeTreeData.fire();

      await this.withProgress(
        `Loading Flink ${itemName}s..`,
        async () => {
          try {
            const loader = CCloudResourceLoader.getInstance();
            if (this._viewMode === ViewMode.Statements) {
              this._statements = await loader.getFlinkStatements(this.computePool!);
            } else {
              this._artifacts = await loader.getFlinkArtifacts(this.computePool!);
            }
          } catch (error) {
            this.logger.error(`Failed to load Flink ${itemName}s`, { error });
            throw error;
          }
        },
        false,
      );
    }

    this._onDidChangeTreeData.fire();
  }

  // Updated getTreeItem to handle both statements and artifacts
  getTreeItem(element: FlinkUnifiedItem): TreeItem {
    if ((element as FlinkStatement).sqlStatement !== undefined) {
      // Return a basic TreeItem for statements using its sqlStatement property as label
      const statement = (element as FlinkStatement).sqlStatement || "Unnamed statement";
      return new TreeItem(statement);
    }
    return new FlinkArtifactTreeItem(element as FlinkArtifact);
  }

  get computePool(): CCloudFlinkComputePool | null {
    return this.resource;
  }
}

// Toggle function based on the same approach as searching
export async function toggleViewMode(): Promise<void> {
  const provider = FlinkArtifactsViewProvider.getInstance();
  const newMode =
    provider.viewMode === ViewMode.Statements ? ViewMode.Artifacts : ViewMode.Statements;
  await provider.setViewMode(newMode);
  await setContextValue(ContextValues.flinkUnifiedView, newMode === ViewMode.Artifacts);
}
