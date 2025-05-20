import { ExtensionContext } from "vscode";
import { getExtensionContext } from "../context/extension";

/** Clears all keys from the `workspaceState` of the {@link ExtensionContext}. */
export async function clearWorkspaceState(): Promise<void> {
  const context: ExtensionContext = getExtensionContext();
  const keys: readonly string[] = context.workspaceState.keys();
  const deletePromises: Thenable<void>[] = keys.map((key) =>
    context.workspaceState.update(key, undefined),
  );
  await Promise.all(deletePromises);
}
