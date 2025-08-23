import { TreeItem } from "vscode";
import { ContextValues, setContextValue } from "../../context/values";
import { BaseViewProviderData } from "./base";
import { EnvironmentedBaseViewProviderData, ParentedBaseViewProvider } from "./parentedBase";

export abstract class ViewProviderDelegate<M extends string, T extends BaseViewProviderData> {
  abstract readonly mode: M;

  abstract readonly viewTitle: string;
  abstract loadingMessage: string;

  abstract children: T[];

  abstract fetchChildren(element?: T): Promise<T[]>;

  getChildren(): T[] {
    return this.children;
  }

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
  protected treeViewDelegates!: Map<M, ViewProviderDelegate<M, T>>;

  protected defaultDelegate!: ViewProviderDelegate<M, T>;
  protected currentDelegate: ViewProviderDelegate<M, T>;

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
