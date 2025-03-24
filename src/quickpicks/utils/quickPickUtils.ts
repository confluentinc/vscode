import * as vscode from "vscode";
import { QuickPickItemWithValue } from "../types";

/**
 * Enhanced options for creating a QuickPick with additional functionality.
 *
 * @example
 * ```typescript
 * const options: EnhancedQuickPickOptions<MyQuickPickItem> = {
 *   title: "Select an item",
 *   placeHolder: "Search items...",
 *   canSelectMany: true,
 *   buttons: [vscode.QuickInputButtons.Back],
 *   onButtonClicked: async (button, quickPick) => {
 *     if (button === vscode.QuickInputButtons.Back) {
 *       quickPick.hide();
 *     }
 *   },
 *   onSelectionChange: (items, quickPick) => {
 *     console.log("Selected items:", items);
 *   }
 * };
 * ```
 */
export interface EnhancedQuickPickOptions<T extends QuickPickItemWithValue<vscode.QuickPickItem>>
  extends vscode.QuickPickOptions {
  /**
   * Callback triggered when a button on a specific QuickPick item is clicked.
   * Useful for implementing actions specific to individual items.
   *
   * @example
   * ```typescript
   * onItemButtonClicked: async ({ button, item, quickPick }) => {
   *   if (button === deleteButton) {
   *     await deleteItem(item.value);
   *     quickPick.items = quickPick.items.filter(i => i !== item);
   *   }
   * }
   * ```
   */
  onItemButtonClicked?: (event: {
    button: vscode.QuickInputButton;
    item: T;
    quickPick: vscode.QuickPick<T>;
  }) => Promise<void> | void;

  /**
   * Callback triggered whenever the selection changes in the QuickPick.
   * Particularly useful when canSelectMany is true to track multiple selections.
   *
   * @example
   * ```typescript
   * onSelectionChange: (items, quickPick) => {
   *   updateStatusBar(`${items.length} items selected`);
   * }
   * ```
   */
  onSelectionChange?: (items: readonly T[], quickPick: vscode.QuickPick<T>) => void;

  /**
   * Callback triggered when the active (highlighted) item changes.
   * Useful for previewing or pre-loading data based on the current focus.
   *
   * @example
   * ```typescript
   * onActiveItemChange: async (item, quickPick) => {
   *   if (item) {
   *     await showPreview(item.value);
   *   }
   * }
   * ```
   */
  onActiveItemChange?: (item: T | undefined, quickPick: vscode.QuickPick<T>) => void;

  /**
   * Navigation buttons displayed at the top of the QuickPick.
   * Common buttons include Back, Refresh, or custom actions.
   *
   * @example
   * ```typescript
   * buttons: [
   *   vscode.QuickInputButtons.Back,
   *   { iconPath: new vscode.ThemeIcon('refresh') }
   * ]
   * ```
   */
  buttons?: readonly vscode.QuickInputButton[];

  /**
   * Callback triggered when a navigation button is clicked.
   * Use this to handle navigation or perform actions based on button clicks.
   *
   * @example
   * ```typescript
   * onButtonClicked: async (button, quickPick) => {
   *   if (button === refreshButton) {
   *     quickPick.busy = true;
   *     quickPick.items = await fetchUpdatedItems();
   *     quickPick.busy = false;
   *   }
   * }
   * ```
   */
  onButtonClicked?: (
    button: vscode.QuickInputButton,
    quickPick: vscode.QuickPick<T>,
  ) => Promise<void> | void;

  /**
   * Enables multi-select mode in the QuickPick.
   * When true, users can select multiple items using checkboxes.
   * @default false
   */
  canSelectMany?: boolean;

  /**
   * Items that should be pre-selected when the QuickPick opens.
   * Only applies when canSelectMany is true.
   *
   * @example
   * ```typescript
   * selectedItems: previouslySelectedItems
   * ```
   */
  selectedItems?: T[];

  /**
   * Controls whether the QuickPick should close when focus is lost.
   * When true, the QuickPick stays open even when focus moves elsewhere.
   * @default false
   */
  ignoreFocusOut?: boolean;

  /**
   * Callback triggered when the user accepts the current selection.
   * This occurs when the user presses Enter or clicks the OK button.
   *
   * @example
   * ```typescript
   * onDidAccept: async (quickPick) => {
   *   const selectedItems = quickPick.selectedItems;
   *   await processSelection(selectedItems);
   *   quickPick.hide();
   * }
   * ```
   */
  onDidAccept?: (quickPick: vscode.QuickPick<T>) => Promise<void> | void;
}

/**
 * Creates and returns a QuickPick instance with enhanced functionality.
 * This allows more direct control over the QuickPick compared to showEnhancedQuickPick.
 *
 * @param items The items to show in the QuickPick
 * @param options Enhanced QuickPick options
 * @returns The configured QuickPick instance
 */
export function createEnhancedQuickPick<T extends QuickPickItemWithValue<vscode.QuickPickItem>>(
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

  if (options?.onDidAccept) {
    quickPick.onDidAccept(() => {
      options.onDidAccept?.(quickPick);
    });
  }

  return quickPick;
}
