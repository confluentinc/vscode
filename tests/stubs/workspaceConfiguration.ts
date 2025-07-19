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
   * Configures the {@linkcode get} stub to return a specific value for a given setting.
   *
   * @param setting The {@link ExtensionSetting} instance to stub. Must have an `id` property.
   * @param value The value to return for the given setting.
   * @returns this {@link StubbedWorkspaceConfiguration} instance for chaining.
   *
   * ---
   *
   * @example
   * ```ts
   * stubbedConfigs.stubGet(LOCAL_KAFKA_IMAGE, "confluentinc/cp-kafka");
   * ```
   * Which is equivalent to:
   * ```ts
   * stubbedConfigs.get.withArgs(LOCAL_KAFKA_IMAGE.id, sinon.match.any).returns("confluentinc/cp-kafka");
   * ```
   */
  stubGet<T>(setting: ExtensionSetting<T>, value: T): StubbedWorkspaceConfiguration {
    // use `match.any` to allow an optional second argument (for the default value)
    this.get.withArgs(setting.id, match.any).returns(value);
    return this;
  }
}
