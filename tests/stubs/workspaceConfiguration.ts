import { SinonSandbox, SinonStub } from "sinon";
import { workspace, WorkspaceConfiguration } from "vscode";

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
   * Configures multiple configuration values that will be returned by the `get` method.
   * @param settings A record/map of setting keys to their return values.
   */
  configure(settings: Record<string, any>): void {
    for (const [key, value] of Object.entries(settings)) {
      this.get.withArgs(key).returns(value);
    }
  }
}
