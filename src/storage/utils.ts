// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ExtensionContext, Memento, SecretStorage } from "vscode";
import { getExtensionContext } from "../context/extension";
import { GlobalState, WorkspaceState } from "./types";

/**
 * Minimal wrapper around the {@link ExtensionContext}'s
 * {@linkcode ExtensionContext.globalState globalState} to allow stubbing {@link Memento} for tests.
 */
export function getGlobalState(): GlobalState {
  const context: ExtensionContext = getExtensionContext();
  return context.globalState;
}

/**
 * Minimal wrapper around the {@link ExtensionContext}'s
 * {@linkcode ExtensionContext.workspaceState workspaceState} to allow stubbing {@link Memento} for tests.
 */
export function getWorkspaceState(): WorkspaceState {
  const context: ExtensionContext = getExtensionContext();
  return context.workspaceState;
}

/**
 * Minimal wrapper around the {@link ExtensionContext}'s
 * {@linkcode ExtensionContext.secrets secrets} to allow stubbing {@link SecretStorage} for tests.
 */
export function getSecretStorage(): SecretStorage {
  const context: ExtensionContext = getExtensionContext();
  return context.secrets;
}

/** Clears all keys from the `workspaceState` of the {@link ExtensionContext}. */
export async function clearWorkspaceState(): Promise<void> {
  const workspaceState: WorkspaceState = getWorkspaceState();
  const keys: readonly string[] = workspaceState.keys();
  const deletePromises: Thenable<void>[] = keys.map((key) => workspaceState.update(key, undefined));
  await Promise.all(deletePromises);
}
