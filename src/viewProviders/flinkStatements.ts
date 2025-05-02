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

  /** Statement id to be focused on after refresh() completes. */
  private toBeFocusedId: string | null = null;

  /**
   * (Re)paint the view.
   * @returns A promise that resolves when the refresh is complete, if caller needs to wait for it.
   */
  refresh(): Promise<void> {
    // Out with any existing subjects.
    this.resourcesInTreeView.clear();

    const completed = new Promise<void>((resolve) => {
      if (this.resource !== null) {
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

            if (this.toBeFocusedId) {
              // If we have a queued request for a statement to focus, do so now.
              logger.debug(
                `Focusing statement ${this.toBeFocusedId} in the view after loading statements`,
              );
              const existingStatement = this.resourcesInTreeView.get(this.toBeFocusedId);
              if (existingStatement) {
                await this.doFocus(existingStatement);
                this.toBeFocusedId = null;
              }
            }
          },
          false,
        );
      }

      // Inform view that toplevel items have changed (because of edging
      // from having old contents to new empty state). When loading is completed inside
      // the withProgress, we will fire _onDidChangeTreeData again to update the view.
      this._onDidChangeTreeData.fire();
      resolve();
    });
    return completed;
  }

  /**
   * Show and select a single statement in the view. If the statement is not
   * already in the view, it will be added to the view.
   */
  async focus(statementId: string): Promise<void> {
    // Find the statement in the tree view.
    const existingStatement = this.resourcesInTreeView.get(statementId);
    if (existingStatement) {
      // If the statement is already in the view, just focus it.
      return await this.doFocus(existingStatement);
    } else {
      // Queue it up to be focused when the view is next refreshed.
      logger.debug("Queuing up statement to be focused in the view");
      this.toBeFocusedId = statementId;
    }
  }

  /**
   * Set focus on the given statement instance which is already in the view and
   * the exact object is present in this.resourcesInTreeView already.
   * @param statement The statement contained within this.resourcesInTreeView to focus on.
   */
  private async doFocus(statement: FlinkStatement): Promise<void> {
    try {
      logger.debug(`doFocus(): Focusing statement ${statement.id} in the view`);
      await this.treeView.reveal(statement, { focus: true, select: true });
    } catch (e) {
      this.logger.error("Error focusing statement in view", e);
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
