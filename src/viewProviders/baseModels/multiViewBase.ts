import { TreeItem } from "vscode";
import { ContextValues, setContextValue } from "../../context/values";
import { BaseViewProviderData } from "./base";
import { EnvironmentedBaseViewProviderData, ParentedBaseViewProvider } from "./parentedBase";

export abstract class ViewProviderDelegate<
  M extends string,
  P extends EnvironmentedBaseViewProviderData,
  T extends BaseViewProviderData,
> {
  /** What view mode does this delegate handle? */
  abstract readonly mode: M;

  /** Title for this view mode */
  abstract readonly viewTitle: string;

  /** Message to display when fetching children */
  abstract readonly loadingMessage: string;

  /** The most recent results from fetchChildren() */
  children: T[] = [];

  /** Returns the most recent results from fetchChildren() */
  getChildren(): T[] {
    return this.children;
  }

  /**
   * Do whatever it takes to fetch children to display.
   *
   * Must assign to this.children before returning.
   *
   * @param resource The parent resource to fetch children for.
   * @param forceDeepRefresh Whether to bypass any caches and fetch fresh data.
   * @returns The fetched children.
   */
  abstract fetchChildren(resource: P, forceDeepRefresh: boolean): Promise<T[]>;

  /**
   * Convert a child element into a TreeItem for display.
   * @param element The child element to convert.
   * @returns The TreeItem representing the child element.
   */
  abstract getTreeItem(element: T): TreeItem;
}

/**
 * Abstract base class for multi-mode view providers that can switch between different modes
 * and delegate tree view operations to mode-specific implementations.
 */
export abstract class MultiModeViewProvider<
  M extends string,
  P extends EnvironmentedBaseViewProviderData,
  T extends BaseViewProviderData,
> extends ParentedBaseViewProvider<P, T> {
  /** Map of available delegates by their {@linkcode ViewProviderDelegate.mode mode} */
  protected treeViewDelegates!: Map<M, ViewProviderDelegate<M, P, T>>;

  protected defaultDelegate!: ViewProviderDelegate<M, P, T>;
  protected currentDelegate: ViewProviderDelegate<M, P, T>;

  /** Optional context value to update when delegate changes */
  protected delegateContextValue?: ContextValues;

  constructor() {
    super();
    this.currentDelegate = this.defaultDelegate;
  }

  /** Switch to a specific mode by its ID. */
  async switchMode(mode: M): Promise<void> {
    const newMode = this.treeViewDelegates.get(mode);
    if (!newMode) {
      this.logger.error(`Unknown mode: ${mode}`);
      return;
    }

    if (this.currentDelegate === newMode) {
      // already in this mode, just refresh
      await this.refresh();
      return;
    }

    this.logger.debug(`switching from mode "${this.currentDelegate?.mode}" to "${mode}"`);
    this.currentDelegate = newMode;
    if (this.delegateContextValue) {
      await setContextValue(this.delegateContextValue, mode);
    }
    this.treeView.title = this.currentDelegate.viewTitle;

    // Reset the number of children matched by search, since the new mode will have
    // a different set of children. The refresh call will reevaluate the search string
    // against the new mode's children and update the count.
    this.searchMatches.clear();
    // likewise reset the total item count, a buggy concept anyway.
    this.totalItemCount = 0;

    await this.refresh();
  }

  getChildren(element?: T): T[] {
    if (!this.resource) {
      return [];
    }
    const children = this.currentDelegate.getChildren();
    return this.filterChildren(element, children);
  }

  getTreeItem(element: T): TreeItem {
    return this.currentDelegate.getTreeItem(element);
  }

  override async reset(): Promise<void> {
    this.currentDelegate = this.defaultDelegate;
    if (this.delegateContextValue) {
      await setContextValue(this.delegateContextValue, this.currentDelegate.mode);
    }
    await super.reset();
  }
}
