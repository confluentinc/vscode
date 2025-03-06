import { QuickPickItem } from "vscode";

/**
 * Extension of {@link QuickPickItem} to include an associated `value` for easier matching on
 * user selection. Unlike `label`, `description`, and `detail`, `value` is not displayed in the
 * quick pick UI.
 */
export type QuickPickItemWithValue<T> = QuickPickItem & {
  value?: T | undefined;
};
// TODO(shoup): migrate other quickpicks to use this type
