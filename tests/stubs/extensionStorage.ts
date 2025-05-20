import { SinonSandbox, SinonStub } from "sinon";
import { ExtensionContext, Memento, SecretStorage } from "vscode";
import { getTestExtensionContext } from "../unit/testUtils";

/** The {@link Memento} interface, where all methods are replaced with {@link SinonStub stubs} */
export interface StubbedMemento extends Memento {
  get: SinonStub;
  keys: SinonStub;
  update: SinonStub;
  setKeysForSync?: SinonStub;
}

/**
 * Stubs the global state of the {@link ExtensionContext}.
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A promise that resolves to the stubbed global state {@link Memento}.
 */
export async function getStubbedGlobalState(sandbox: SinonSandbox): Promise<StubbedMemento> {
  return await getStubbedMemento(sandbox, "globalState");
}

/**
 * Stubs the `workspaceState` of the {@link ExtensionContext}.
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @returns A promise that resolves to the stubbed workspace state {@link Memento}.
 */
export async function getStubbedWorkspaceState(sandbox: SinonSandbox): Promise<StubbedMemento> {
  return await getStubbedMemento(sandbox, "workspaceState");
}

/**
 * Stubs the {@link Memento} used by the {@link ExtensionContext}, for either global or workspace state.
 * @param sandbox The {@link SinonSandbox} to use for stubbing.
 * @param type The type of state to stub, either "globalState" or "workspaceState".
 * @returns A promise that resolves to the stubbed {@link Memento}.
 */
async function getStubbedMemento(
  sandbox: SinonSandbox,
  type: "globalState" | "workspaceState",
): Promise<StubbedMemento> {
  const context: ExtensionContext = await getTestExtensionContext();

  const stubbedMemento: StubbedMemento = {
    // stub `get` to handle both overload signatures
    get: sandbox.stub().callsFake((key: string, defaultValue?: any) => {
      return defaultValue !== undefined ? defaultValue : undefined;
    }),
    keys: sandbox.stub().returns([]),
    update: sandbox.stub().resolves(),
  };

  if (type === "globalState") {
    const setKeysForSyncStub = sandbox.stub().returns(undefined);
    // not part of the Memento interface directly; see
    // https://github.com/DefinitelyTyped/DefinitelyTyped/blob/6f0a6fe9cdd5fe26424749033c0159aa3186854b/types/vscode/index.d.ts#L8390
    (stubbedMemento as any).setKeysForSync = setKeysForSyncStub;
  }

  sandbox.stub(context, type).returns(stubbedMemento);
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
  // stub the ExtensionContext to use our stubbed interface
  const context: ExtensionContext = await getTestExtensionContext();
  sandbox.stub(context, "secrets").returns(stubbedSecretStorage);
  return stubbedSecretStorage;
}
