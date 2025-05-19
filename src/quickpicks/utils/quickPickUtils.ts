import { Disposable, QuickInputButton, QuickPick, QuickPickOptions, window } from "vscode";
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
 *   buttons: [QuickInputButtons.Back],
 *   onButtonClicked: async (button, quickPick) => {
 *     if (button === QuickInputButtons.Back) {
 *       quickPick.hide();
 *     }
 *   },
 *   onSelectionChange: (items, quickPick) => {
 *     console.log("Selected items:", items);
 *   }
 * };
 * ```
 */
export interface EnhancedQuickPickOptions<T extends QuickPickItemWithValue<any>>
  extends QuickPickOptions {
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
    button: QuickInputButton;
    item: T;
    quickPick: QuickPick<T>;
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
  onSelectionChange?: (items: readonly T[], quickPick: QuickPick<T>) => void;

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
  onActiveItemChange?: (item: T | undefined, quickPick: QuickPick<T>) => void;

  /**
   * Navigation buttons displayed at the top of the QuickPick.
   * Common buttons include Back, Refresh, or custom actions.
   *
   * @example
   * ```typescript
   * buttons: [
   *   QuickInputButtons.Back,
   *   { iconPath: new ThemeIcon('refresh') }
   * ]
   * ```
   */
  buttons?: readonly QuickInputButton[];

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
  onButtonClicked?: (button: QuickInputButton, quickPick: QuickPick<T>) => Promise<void> | void;

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
  onDidAccept?: (quickPick: QuickPick<T>) => Promise<void> | void;
}

/**
 * Creates and returns a QuickPick instance with enhanced functionality.
 * The QuickPick will be shown immediately and the function will wait for completion.
 *
 * @param items The items to show in the QuickPick
 * @param options Enhanced QuickPick options
 * @returns A Promise that resolves to an object containing the QuickPick instance and selected items after it is hidden
 */
export function createEnhancedQuickPick<T extends QuickPickItemWithValue<any>>(
  items: T[] | Promise<T[]>,
  options?: EnhancedQuickPickOptions<T>,
): Promise<{ quickPick: QuickPick<T>; selectedItems: T[] }> {
  const quickPick: QuickPick<T> = window.createQuickPick<T>();

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

    // Set default selected items if provided and items are already available
    if (options?.selectedItems && options.selectedItems.length > 0) {
      quickPick.selectedItems = options.selectedItems;
    }
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

  const disposables: Disposable[] = [];

  // Set up event handlers
  if (options?.onSelectionChange) {
    const onSelectionChangeSub: Disposable = quickPick.onDidChangeSelection(
      (items: readonly T[]) => {
        options.onSelectionChange?.(items, quickPick);
      },
    );
    disposables.push(onSelectionChangeSub);
  }

  if (options?.onActiveItemChange) {
    const onActiveItemChangeSub: Disposable = quickPick.onDidChangeActive((items: readonly T[]) => {
      options.onActiveItemChange?.(items[0], quickPick);
    });
    disposables.push(onActiveItemChangeSub);
  }

  if (options?.onItemButtonClicked) {
    const onItemButtonClickedSub: Disposable = quickPick.onDidTriggerItemButton((event) => {
      options.onItemButtonClicked?.({
        button: event.button,
        item: event.item as T,
        quickPick,
      });
    });
    disposables.push(onItemButtonClickedSub);
  }

  if (options?.onButtonClicked) {
    const onButtonClickedSub: Disposable = quickPick.onDidTriggerButton((button) => {
      options.onButtonClicked?.(button, quickPick);
    });
    disposables.push(onButtonClickedSub);
  }

  // the only time we actually set `selectedItems` is when the user accepts the quickpick, where we
  // then copy over any items marked for selection. we can't just return quickpick.selectedItems
  // because other events may have caused the quickpick to be hidden and we may not want to return
  // the selected items at that point.
  const selectedItems: T[] = [];
  const onDidAcceptSub: Disposable = quickPick.onDidAccept(() => {
    if (options?.onDidAccept) {
      // handle any additional behavior before hiding, if a custom onDidAccept is provided
      options.onDidAccept(quickPick);
    }
    selectedItems.push(...quickPick.selectedItems);
    quickPick.hide();
  });
  disposables.push(onDidAcceptSub);

  // Show the QuickPick and return a promise that resolves when it's hidden
  quickPick.show();
  return new Promise((resolve) => {
    const onDidHideSub: Disposable = quickPick.onDidHide(() => {
      onDidHideSub.dispose();
      disposables.forEach((d) => d.dispose());
      resolve({ quickPick, selectedItems });
    });
  });
}
