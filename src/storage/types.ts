import { Memento } from "vscode";
import { UriMetadataKeys } from "./constants";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ExtensionContext } from "vscode";

/** Record that uses any {@link UriMetadataKeys} value for its keys.  */
export type UriMetadata = Partial<Record<UriMetadataKeys, any>>;

/** Map of stringified resource {@link Uri}s to their associated metadata objects. */
export type UriMetadataMap = Map<string, UriMetadata>;

/** Type alias for the {@link ExtensionContext}'s {@linkcode ExtensionContext.workspaceState workspaceState} */
export type WorkspaceState = Memento;

/** Type alias for the {@link ExtensionContext}'s {@linkcode ExtensionContext.globalState globalState} */
export type GlobalState = Memento & {
  setKeysForSync(keys: readonly string[]): void;
};
