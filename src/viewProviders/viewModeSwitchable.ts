import * as vscode from "vscode";

/**
 * Abstract class that enables switching between two sub-view providers.
 * This provider manages the state and transitions between different view modes.
 */
export abstract class ViewModeSwitchableProvider<T extends vscode.TreeItem>
  implements vscode.TreeDataProvider<T>, vscode.Disposable
{
  private _onDidChangeTreeData: vscode.EventEmitter<T | undefined | null | void> =
    new vscode.EventEmitter<T | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<T | undefined | null | void> =
    this._onDidChangeTreeData.event;

  protected primaryProvider: vscode.TreeDataProvider<T>;
  protected secondaryProvider: vscode.TreeDataProvider<T>;
  protected disposables: vscode.Disposable[] = [];
  protected currentMode: "primary" | "secondary" = "primary";

  constructor(
    primaryProvider: vscode.TreeDataProvider<T>,
    secondaryProvider: vscode.TreeDataProvider<T>,
    initialMode: "primary" | "secondary" = "primary",
  ) {
    this.primaryProvider = primaryProvider;
    this.secondaryProvider = secondaryProvider;
    this.currentMode = initialMode;

    // Register change listeners for both providers
    if ("onDidChangeTreeData" in this.primaryProvider) {
      if (this.primaryProvider.onDidChangeTreeData !== undefined) {
        this.disposables.push(
          this.primaryProvider.onDidChangeTreeData((item) => {
            if (this.currentMode === "primary") {
              this._onDidChangeTreeData.fire(item as T);
            }
          }),
        );
      }
    }

    if ("onDidChangeTreeData" in this.secondaryProvider) {
      if (this.secondaryProvider.onDidChangeTreeData !== undefined) {
        this.disposables.push(
          this.secondaryProvider.onDidChangeTreeData((item) => {
            if (this.currentMode === "secondary") {
              this._onDidChangeTreeData.fire(item as T);
            }
          }),
        );
      }
    }
  }

  /**
   * Get the current active provider based on mode
   */
  protected get activeProvider(): vscode.TreeDataProvider<T> {
    return this.currentMode === "primary" ? this.primaryProvider : this.secondaryProvider;
  }

  /**
   * Switch between primary and secondary view modes
   * @param mode The mode to switch to
   */
  public switchMode(mode: "primary" | "secondary"): void {
    if (this.currentMode !== mode) {
      console.log(`ViewModeSwitchableProvider: switching from ${this.currentMode} to ${mode} mode`);
      this.currentMode = mode;

      // Ensure the tree view is updated immediately
      this._onDidChangeTreeData.fire();

      // Add a small delay and fire again to ensure UI updates
      // This helps with any asynchronous loading that might be happening
      setTimeout(() => {
        console.log(`ViewModeSwitchableProvider: delayed update for ${mode} mode`);
        this._onDidChangeTreeData.fire();
      }, 200);
    }
  }

  /**
   * Toggle between primary and secondary view modes
   */
  public toggleMode(): void {
    const newMode = this.currentMode === "primary" ? "secondary" : "primary";
    this.switchMode(newMode);
  }

  /**
   * Get the current view mode
   */
  public getMode(): "primary" | "secondary" {
    return this.currentMode;
  }

  /**
   * Refresh the tree view
   * @param element Optional element to refresh
   */
  public refresh(element?: T): void {
    this._onDidChangeTreeData.fire(element);
  }

  /**
   * Get tree item implementation - delegates to the active provider
   * @param element The element to get the TreeItem for
   */
  public getTreeItem(element: T): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return this.activeProvider.getTreeItem(element);
  }

  /**
   * Get children implementation - delegates to the active provider
   * @param element The element to get children for
   */
  public getChildren(element?: T): vscode.ProviderResult<T[]> {
    return this.activeProvider.getChildren(element);
  }

  /**
   * Get parent implementation if available in the active provider
   * @param element The element to get the parent for
   */
  public getParent?(element: T): vscode.ProviderResult<T> {
    if (this.activeProvider.getParent) {
      return this.activeProvider.getParent(element);
    }
    return null;
  }

  //   /**
  //    * Resolve tree item if available in the active provider
  //    * @param item The item to resolve
  //    * @param element The element
  //    */
  //   public resolveTreeItem?(
  //     item: vscode.TreeItem,
  //     element: T,
  //   ): vscode.ProviderResult<vscode.TreeItem> {
  //     if (this.activeProvider.resolveTreeItem) {
  //       return this.activeProvider.resolveTreeItem(item, element);
  //     }
  //     return item;
  //   }

  /**
   * Clean up resources when this provider is no longer needed
   */
  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
