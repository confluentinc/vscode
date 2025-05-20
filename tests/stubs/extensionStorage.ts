import { SinonSandbox, SinonStub } from "sinon";
import { ExtensionContext, Memento, SecretStorage } from "vscode";
import * as storageUtils from "../../src/storage/utils";

/** The {@link Memento} interface, where all methods are replaced with {@link SinonStub stubs} */
export interface StubbedMemento extends Memento {
  get: SinonStub;
  keys: SinonStub;
  update: SinonStub;
}

export interface StubbedGlobalState extends StubbedMemento {
  setKeysForSync: SinonStub;
}

/**
 * Stubs the global state of the {@link ExtensionContext}.
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A promise that resolves to the stubbed global state {@link Memento}.
 */
export async function getStubbedGlobalState(sandbox: SinonSandbox): Promise<StubbedGlobalState> {
  const stubbedMemento: StubbedMemento = await getStubbedMemento(sandbox);
  // not part of the Memento interface directly; see
  // https://github.com/DefinitelyTyped/DefinitelyTyped/blob/6f0a6fe9cdd5fe26424749033c0159aa3186854b/types/vscode/index.d.ts#L8390
  const stubbedGlobalState: StubbedGlobalState = {
    ...stubbedMemento,
    setKeysForSync: sandbox.stub(),
  };
  sandbox.stub(storageUtils, "getGlobalState").returns(stubbedGlobalState);
  return stubbedGlobalState;
}

/**
 * Stubs the `workspaceState` of the {@link ExtensionContext}.
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A promise that resolves to the stubbed workspace state {@link Memento}.
 */
export async function getStubbedWorkspaceState(sandbox: SinonSandbox): Promise<StubbedMemento> {
  const stubbedWorkspaceState: StubbedMemento = await getStubbedMemento(sandbox);
  sandbox.stub(storageUtils, "getWorkspaceState").returns(stubbedWorkspaceState);
  return stubbedWorkspaceState;
}

/**
 * Stubs the {@link Memento} used by the {@link ExtensionContext}, for either global or workspace state.
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @param type The type of state to stub, either "globalState" or "workspaceState".
 * @returns A promise that resolves to the stubbed {@link Memento}.
 */
async function getStubbedMemento(
  sandbox: SinonSandbox,
): Promise<StubbedMemento | StubbedGlobalState> {
  const stubbedMemento: StubbedMemento = {
    // stub `get` to handle both overload signatures
    get: sandbox.stub(),
    keys: sandbox.stub().returns([]),
    update: sandbox.stub().resolves(),
  };
  return stubbedMemento;
}

/** The {@link SecretStorage} interface, where all methods are replaced with {@link SinonStub stubs} */
export interface StubbedSecretStorage extends SecretStorage {
  get: SinonStub;
  store: SinonStub;
  delete: SinonStub;
  onDidChange: SinonStub;
}

/**
 * Stubs the `secrets` of the {@link ExtensionContext}.
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A promise that resolves to the stubbed secrets {@link Memento}.
 */
export async function getStubbedSecretStorage(
  sandbox: SinonSandbox,
): Promise<StubbedSecretStorage> {
  // set up the method stubs
  const stubbedSecretStorage: StubbedSecretStorage = {
    get: sandbox.stub().resolves(),
    store: sandbox.stub().resolves(),
    delete: sandbox.stub().resolves(),
    onDidChange: sandbox.stub(),
  };
  // stub our helper functions since ExtensionContext.secrets can't be stubbed directly
  sandbox.stub(storageUtils, "getSecretStorage").returns(stubbedSecretStorage);
  return stubbedSecretStorage;
}
