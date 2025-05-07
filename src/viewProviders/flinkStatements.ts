import { TreeDataProvider, TreeItem } from "vscode";
import { ContextValues } from "../context/values";
import { currentFlinkStatementsResourceChanged } from "../emitters";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, FlinkStatementTreeItem } from "../models/flinkStatement";
import { BaseViewProvider } from "./base";

const logger = new Logger("viewProviders.flinkStatements");
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
  readonly kind = "statements";
  loggerName = "viewProviders.flinkStatements";
  viewId = "confluent-flink-statements";

  parentResourceChangedEmitter = currentFlinkStatementsResourceChanged;
  parentResourceChangedContextValue = ContextValues.flinkStatementsPoolSelected;

  searchContextValue = ContextValues.flinkStatementsSearchApplied;

  // Map of resource id string -> resource currently in the tree view.
  private resourcesInTreeView: Map<string, FlinkStatement> = new Map();

  /**
   * Reload all statements in the view. This is a deep refresh, meaning
   * that it will clear the view and reload all statements from the
   * compute cluster / environment.
   *
   * @returns A promise that resolves when the refresh is complete.
   */
  refresh(): Promise<void> {
    // Out with any existing subjects.
    this.resourcesInTreeView.clear();

    const completed = new Promise<void>((resolve) => {
      if (this.resource !== null) {
        // Immediately inform the view that we (temporarily) have no data so it will clear.
        this._onDidChangeTreeData.fire();

        // And set up to deep refresh.
        const loader = ResourceLoader.getInstance(
          this.resource.connectionId,
        ) as CCloudResourceLoader;

        void this.withProgress(
          "Loading Flink statements...",
          async () => {
            // Fetch statements, remember them, and indicate to the view that we have new data.
            const statements = await loader.getFlinkStatements(this.resource!);
            statements.forEach((r: FlinkStatement) => this.resourcesInTreeView.set(r.id, r));
            this._onDidChangeTreeData.fire();
            resolve();
          },
          false,
        );
      } else {
        // No resource selected, so just inform the view that we have no data.
        // (this.resourcesInTreeView has already been cleared.)
        this._onDidChangeTreeData.fire();
        resolve();
      }
    });

    return completed;
  }

  /**
   * Show and select a single statement in the view.
   * Async because asking the tree view to reveal a statement is async, and we need to await it
   * to ensure it doesn't throw an error.
   *
   * @throws Error if the statement is not found in the view.
   * @param statementId The id of the statement to focus.
   *
   **/
  async focus(statementId: string): Promise<void> {
    const logger = this.logger.withCallpoint("focus()");

    // Find the statement in the tree view.
    const existingStatement = this.resourcesInTreeView.get(statementId);
    if (existingStatement) {
      // If the statement is already in the view, just focus it.
      try {
        logger.debug(`Focusing statement ${existingStatement.id} in the view`);
        await this.treeView.reveal(existingStatement, { focus: true, select: true });
        return;
      } catch (e) {
        this.logger.error("Error focusing statement in view", e);
        throw e;
      }
    } else {
      logger.error("Could not find statement in the view", statementId);
      throw new Error(`Could not find statement ${statementId} in the view`);
    }
  }

  async getChildren(): Promise<FlinkStatement[]> {
    const children: FlinkStatement[] = Array.from(this.resourcesInTreeView.values());

    // Sort by statement creation time descending.
    children.sort((a: FlinkStatement, b: FlinkStatement) => {
      // These really should never be undefined, but just in case.
      if (a.createdAt === undefined || b.createdAt === undefined) {
        return 0;
      }

      return b.createdAt!.valueOf() - a.createdAt!.valueOf();
    });

    return this.filterChildren(undefined, children);
  }

  /**
   * Return the parent of any element. This is always null, as we are not
   * showing a tree of statements within a parent.
   * Required by the TreeDataProvider interface if we want to use .reveal().
   */
  getParent(): null {
    return null;
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
