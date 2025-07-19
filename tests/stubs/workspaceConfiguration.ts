import { match, SinonSandbox, SinonStub } from "sinon";
import { workspace, WorkspaceConfiguration } from "vscode";
import { ExtensionSetting } from "../../src/extensionSettings/base";

/**
 * The {@link WorkspaceConfiguration} interface, where all methods are replaced with {@link SinonStub stubs}.
 * @see https://code.visualstudio.com/api/references/vscode-api#WorkspaceConfiguration
 */
interface StubbedWorkspaceConfigurationInterface extends WorkspaceConfiguration {
  get: SinonStub;
  update: SinonStub;
  has: SinonStub;
  inspect: SinonStub;
}

export class StubbedWorkspaceConfiguration implements StubbedWorkspaceConfigurationInterface {
  public readonly get: SinonStub;
  public readonly update: SinonStub;
  public readonly has: SinonStub;
  public readonly inspect: SinonStub;

  constructor(sandbox: SinonSandbox) {
    this.get = sandbox.stub();
    this.update = sandbox.stub().resolves();
    this.has = sandbox.stub();
    this.inspect = sandbox.stub();
    sandbox.stub(workspace, "getConfiguration").returns(this);
  }

  /**
   * Stubs the {@linkcode get} method to return a specific value for a given setting and return this to allow chaining. (This uses the
   * {@linkcode ExtensionSetting.id id} when performing the {@linkcode WorkspaceConfiguration.get} call.)
   * @param setting The {@link ExtensionSetting} to stub.
   * @param value The value to return for the `setting`.
   */
  stubGet<T>(setting: ExtensionSetting<T>, value: T): StubbedWorkspaceConfiguration {
    // use `match.any` to allow an optional second argument (for the default value)
    this.get.withArgs(setting.id, match.any).returns(value);
    return this;
  }
}
