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
    quickPick: vscode.QuickPick<T>;
  }) => Promise<void> | void;

  /**
   * Callback for when selection changes
   */
  onSelectionChange?: (items: readonly T[], quickPick: vscode.QuickPick<T>) => void;

  /**
   * Callback for when the active item changes
   */
  onActiveItemChange?: (item: T | undefined, quickPick: vscode.QuickPick<T>) => void;

  /**
   * Additional navigation buttons to show at the top of the QuickPick
   */
  buttons?: readonly vscode.QuickInputButton[];

  /**
   * Callback for when a navigation button is triggered
   */
  onButtonClicked?: (
    button: vscode.QuickInputButton,
    quickPick: vscode.QuickPick<T>,
  ) => Promise<void> | void;

  /**
   * Whether this QuickPick should allow selecting multiple items
   */
  canSelectMany?: boolean;

  /**
   * Items that should be selected by default
   */
  selectedItems?: T[];

  /**
   * Whether the QuickPick should ignore focus out
   */
  ignoreFocusOut?: boolean;
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

  // Set default selected items if provided
  if (options?.selectedItems && options.selectedItems.length > 0) {
    quickPick.selectedItems = options.selectedItems;
  }

  // Set up event handlers
  let selectedItems: T[] = [];

  if (options?.onSelectionChange) {
    quickPick.onDidChangeSelection((items: readonly T[]) => {
      options.onSelectionChange?.(items, quickPick);
    });
  }

  if (options?.onActiveItemChange) {
    quickPick.onDidChangeActive((items: readonly T[]) => {
      options.onActiveItemChange?.(items[0], quickPick);
    });
  }

  if (options?.onItemButtonClicked) {
    quickPick.onDidTriggerItemButton((event) => {
      options.onItemButtonClicked?.({
        button: event.button,
        item: event.item as T,
        quickPick,
      });
    });
  }

  if (options?.onButtonClicked) {
    quickPick.onDidTriggerButton((button) => {
      options.onButtonClicked?.(button, quickPick);
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

/**
 * Creates and returns a QuickPick instance with enhanced functionality.
 * This allows more direct control over the QuickPick compared to showEnhancedQuickPick.
 *
 * @param items The items to show in the QuickPick
 * @param options Enhanced QuickPick options
 * @returns The configured QuickPick instance
 */
export function createEnhancedQuickPick<T extends vscode.QuickPickItem>(
  items: T[] | Promise<T[]>,
  options?: EnhancedQuickPickOptions<T>,
): vscode.QuickPick<T> {
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
  if (!(items instanceof Promise)) {
    quickPick.items = items;
  } else {
    // Handle promise asynchronously
    (async () => {
      quickPick.busy = true;
      quickPick.items = await items;
      quickPick.busy = false;

      // Set default selected items if provided (after items are loaded)
      if (options?.selectedItems && options.selectedItems.length > 0) {
        quickPick.selectedItems = options.selectedItems;
      }
    })();
  }

  // Set default selected items if provided and items are already available
  if (!(items instanceof Promise) && options?.selectedItems && options.selectedItems.length > 0) {
    quickPick.selectedItems = options.selectedItems;
  }

  // Set up event handlers
  if (options?.onSelectionChange) {
    quickPick.onDidChangeSelection((items: readonly T[]) => {
      options.onSelectionChange?.(items, quickPick);
    });
  }

  if (options?.onActiveItemChange) {
    quickPick.onDidChangeActive((items: readonly T[]) => {
      options.onActiveItemChange?.(items[0], quickPick);
    });
  }

  if (options?.onItemButtonClicked) {
    quickPick.onDidTriggerItemButton((event) => {
      options.onItemButtonClicked?.({
        button: event.button,
        item: event.item as T,
        quickPick,
      });
    });
  }

  if (options?.onButtonClicked) {
    quickPick.onDidTriggerButton((button) => {
      options.onButtonClicked?.(button, quickPick);
    });
  }

  return quickPick;
}
