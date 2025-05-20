import { SinonSandbox, SinonStub } from "sinon";
import { ExtensionContext, Memento, SecretStorage } from "vscode";
import { GlobalState, WorkspaceState } from "../../src/storage/types";
import * as storageUtils from "../../src/storage/utils";

/**
 * The {@link Memento} interface, where all methods are replaced with {@link SinonStub stubs}.
 * @see https://code.visualstudio.com/api/references/vscode-api#Memento
 */
interface StubbedMemento extends Memento {
  get: SinonStub;
  keys: SinonStub;
  update: SinonStub;
}

/**
 * Creates a "stubbed instance" of the {@link Memento} interface used by the {@link ExtensionContext}.
 *
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A "stubbed instance" of the {@link Memento} interface.
 */
function getStubbedMemento(sandbox: SinonSandbox): StubbedMemento {
  const stubbedMemento: StubbedMemento = {
    get: sandbox.stub(),
    keys: sandbox.stub().returns([]),
    update: sandbox.stub().resolves(),
  };
  return stubbedMemento;
}

/**
 * The {@link WorkspaceState} ({@link Memento}) interface, where all methods are replaced with
 * {@link SinonStub stubs}.
 * @see https://code.visualstudio.com/api/references/vscode-api#Extension&lt;T&gt;:~:text=workspaceState%3A%20Memento
 */
export type StubbedWorkspaceState = StubbedMemento;

/**
 * Stubs the `workspaceState` of the {@link ExtensionContext} through
 * {@linkcode storageUtils.getWorkspaceState getWorkspaceState()} (since `workspaceState` can't be
 * stubbed directly).
 *
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A "stubbed instance" of the {@link WorkspaceState} ({@link Memento}) interface.
 */
export function getStubbedWorkspaceState(sandbox: SinonSandbox): StubbedWorkspaceState {
  const stubbedWorkspaceState: StubbedMemento = getStubbedMemento(sandbox);
  // can't stub ExtensionContext.workspaceState directly, so we stub our helper function
  sandbox.stub(storageUtils, "getWorkspaceState").returns(stubbedWorkspaceState);
  return stubbedWorkspaceState as StubbedWorkspaceState;
}

/**
 * The {@link GlobalState} ({@link Memento}) interface, where all methods are replaced with
 * {@link SinonStub stubs}, plus the `setKeysForSync` method.
 * @see https://code.visualstudio.com/api/references/vscode-api#Extension&lt;T&gt;:~:text=globalState%3A%20Memento%20%26%20%7BsetKeysForSync%7D
 */
export interface StubbedGlobalState extends StubbedMemento {
  setKeysForSync: SinonStub;
}

/**
 * Stubs the `globalState` of the {@link ExtensionContext} through
 * {@linkcode storageUtils.getGlobalState getGlobalState()} (since `globalState` can't be
 * stubbed directly).
 *
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A "stubbed instance" of the {@link GlobalState} ({@link Memento}) interface.
 */
export function getStubbedGlobalState(sandbox: SinonSandbox): StubbedGlobalState {
  const stubbedMemento: StubbedMemento = getStubbedMemento(sandbox);
  // not part of the Memento interface directly; see
  // https://github.com/DefinitelyTyped/DefinitelyTyped/blob/6f0a6fe9cdd5fe26424749033c0159aa3186854b/types/vscode/index.d.ts#L8390
  const stubbedGlobalState: StubbedGlobalState = {
    ...stubbedMemento,
    setKeysForSync: sandbox.stub(),
  };
  // can't stub ExtensionContext.globalState directly, so we stub our helper function
  sandbox.stub(storageUtils, "getGlobalState").returns(stubbedGlobalState);
  return stubbedGlobalState;
}

/**
 * The {@link SecretStorage} interface, where all methods are replaced with {@link SinonStub stubs}.
 * @see https://code.visualstudio.com/api/references/vscode-api#SecretStorage
 */
export interface StubbedSecretStorage extends SecretStorage {
  get: SinonStub;
  store: SinonStub;
  delete: SinonStub;
  onDidChange: SinonStub;
}

/**
 * Stubs the `secrets` of the {@link ExtensionContext} through
 * {@linkcode storageUtils.getSecretStorage getSecretStorage()} (since `secrets` can't be
 * stubbed directly).
 *
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A "stubbed instance" of the {@link SecretStorage} interface.
 */
export function getStubbedSecretStorage(sandbox: SinonSandbox): StubbedSecretStorage {
  // set up the method stubs
  const stubbedSecretStorage: StubbedSecretStorage = {
    get: sandbox.stub().resolves(),
    store: sandbox.stub().resolves(),
    delete: sandbox.stub().resolves(),
    onDidChange: sandbox.stub(),
  };
  // can't stub ExtensionContext.secrets directly, so we stub our helper function
  sandbox.stub(storageUtils, "getSecretStorage").returns(stubbedSecretStorage);
  return stubbedSecretStorage;
}
