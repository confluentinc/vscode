import * as vscode from "vscode";

/**
 * Interface extending QuickPickOptions with additional callback options
 */
export interface EnhancedQuickPickOptions<T extends vscode.QuickPickItem>
  extends vscode.QuickPickOptions {
  /**
   * Callback for when an item button is triggered
   */
  onItemButtonClicked?: (event: {
    button: vscode.QuickInputButton;
    item: T;
  }) => Promise<void> | void;

  /**
   * Callback for when selection changes
   */
  onSelectionChange?: (items: readonly T[]) => void;

  /**
   * Callback for when the active item changes
   */
  onActiveItemChange?: (item: T | undefined) => void;

  /**
   * Additional navigation buttons to show at the top of the QuickPick
   */
  buttons?: readonly vscode.QuickInputButton[];

  /**
   * Callback for when a navigation button is triggered
   */
  onButtonClicked?: (button: vscode.QuickInputButton) => Promise<void> | void;

  /**
   * Whether this QuickPick should allow selecting multiple items
   */
  canSelectMany?: boolean;
}

/**
 * Enhanced version of showQuickPick that provides additional functionality
 * like button callbacks while maintaining a similar API to the original.
 *
 * @param items The items to show in the QuickPick
 * @param options Enhanced QuickPick options
 * @returns A promise that resolves to the selected item(s) or undefined if canceled
 */
export async function showEnhancedQuickPick<T extends vscode.QuickPickItem>(
  items: T[] | Promise<T[]>,
  options?: EnhancedQuickPickOptions<T>,
): Promise<T | T[] | undefined> {
  // Create QuickPick instance
  const quickPick = vscode.window.createQuickPick<T>();

  // Set standard options
  if (options) {
    quickPick.placeholder = options.placeHolder;
    quickPick.ignoreFocusOut = options.ignoreFocusOut ?? false;
    quickPick.title = options.title;
    quickPick.canSelectMany = options.canSelectMany ?? false;
    quickPick.matchOnDescription = options.matchOnDescription ?? false;
    quickPick.matchOnDetail = options.matchOnDetail ?? false;
    quickPick.buttons = options.buttons ?? [];
  }

  // Set items (handle promise if needed)
  if (items instanceof Promise) {
    quickPick.busy = true;
    quickPick.items = await items;
    quickPick.busy = false;
  } else {
    quickPick.items = items;
  }

  // Set up event handlers
  let selectedItems: T[] = [];

  if (options?.onSelectionChange) {
    quickPick.onDidChangeSelection((items: readonly T[]) => {
      options.onSelectionChange?.(items);
    });
  }

  if (options?.onActiveItemChange) {
    quickPick.onDidChangeActive((items: readonly T[]) => {
      options.onActiveItemChange?.(items[0]);
    });
  }

  if (options?.onItemButtonClicked) {
    quickPick.onDidTriggerItemButton((event) => {
      // Type assertion is safe because we're using the same generic type T
      options.onItemButtonClicked?.(event as { button: vscode.QuickInputButton; item: T });
    });
  }

  if (options?.onButtonClicked) {
    quickPick.onDidTriggerButton((button) => {
      options.onButtonClicked?.(button);
    });
  }

  quickPick.onDidAccept(() => {
    selectedItems = [...quickPick.selectedItems];
    quickPick.hide();
  });

  // Show the QuickPick
  quickPick.show();

  // Wait for the QuickPick to be hidden
  await new Promise<void>((resolve) => {
    quickPick.onDidHide(() => {
      resolve();
    });
  });

  // Return the selected item(s) or undefined
  if (selectedItems.length === 0) {
    return undefined;
  }

  return options?.canSelectMany ? selectedItems : selectedItems[0];
}
