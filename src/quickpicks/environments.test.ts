import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { IconNames } from "../constants";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { EnvironmentId } from "../models/resource";
import * as connections from "../sidecar/connections/ccloud";
import { ccloudEnvironmentQuickPick, flinkCcloudEnvironmentQuickPick } from "./environments";

describe("quickpicks/environments.ts ccloudEnvironmentQuickPick() / flinkCcloudEnvironmentQuickPick()", function () {
  let sandbox: sinon.SinonSandbox;

  let showQuickPickStub: sinon.SinonStub;
  let showInfoStub: sinon.SinonStub;
  let hasCCloudAuthSessionStub: sinon.SinonStub;
  let getInstanceStub: sinon.SinonStub;

  let loaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;

  // No flink compute pools.
  const noFlinkEnvironment = TEST_CCLOUD_ENVIRONMENT;

  const flinkableEnvironment = new CCloudEnvironment({
    ...TEST_CCLOUD_ENVIRONMENT,
    id: "flinkable-env" as EnvironmentId,
    name: "flinkable-env",
    flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
  });

  const testEnvironments = [noFlinkEnvironment, flinkableEnvironment];

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // vscode stubs
    showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
    showInfoStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();

    // Other stubs
    hasCCloudAuthSessionStub = sandbox.stub(connections, "hasCCloudAuthSession").returns(true);

    loaderStub = sandbox.createStubInstance(CCloudResourceLoader);
    getInstanceStub = sandbox.stub(CCloudResourceLoader, "getInstance").returns(loaderStub);
    loaderStub.getEnvironments.resolves(testEnvironments);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should show information message and return undefined when not authenticated", async function () {
    hasCCloudAuthSessionStub.returns(false);

    const result = await ccloudEnvironmentQuickPick(undefined);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWithExactly(showInfoStub, "No Confluent Cloud connection found.");
    sinon.assert.notCalled(showQuickPickStub);
  });

  it("should show information message and return undefined when no environments are found", async function () {
    loaderStub.getEnvironments.resolves([]);

    const result = await ccloudEnvironmentQuickPick(undefined);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWithExactly(showInfoStub, "No Confluent Cloud environments found.");
    sinon.assert.notCalled(showQuickPickStub);
  });

  it("should correctly set quickpick options", async function () {
    await ccloudEnvironmentQuickPick(undefined);

    sinon.assert.calledOnce(showQuickPickStub);
    const options = showQuickPickStub.firstCall.args[1];
    assert.strictEqual(options.placeHolder, "Select an environment");
  });

  it("should get environments from the CCloudResourceLoader", async function () {
    await ccloudEnvironmentQuickPick(undefined);

    sinon.assert.calledOnce(getInstanceStub);
    sinon.assert.calledOnce(loaderStub.getEnvironments);
  });

  it("should show quickpick with environments and appropriate icons", async function () {
    await ccloudEnvironmentQuickPick(undefined);

    sinon.assert.calledOnce(showQuickPickStub);

    const quickPickItems: vscode.QuickPickItem[] = showQuickPickStub.firstCall.args[0];
    assert.strictEqual(quickPickItems.length, 2);

    // Check the first environment
    assert.strictEqual(quickPickItems[0].label, noFlinkEnvironment.name);
    assert.strictEqual(quickPickItems[0].description, noFlinkEnvironment.id);
    assert.strictEqual(
      (quickPickItems[0].iconPath as vscode.ThemeIcon).id,
      IconNames.CCLOUD_ENVIRONMENT,
    );

    // Check the second environment
    assert.strictEqual(quickPickItems[1].label, flinkableEnvironment.name);
    assert.strictEqual(quickPickItems[1].description, flinkableEnvironment.id);
    assert.strictEqual(
      (quickPickItems[1].iconPath as vscode.ThemeIcon).id,
      IconNames.CCLOUD_ENVIRONMENT,
    );
  });

  it("should return the selected environment", async function () {
    showQuickPickStub.resolves({
      label: noFlinkEnvironment.name,
      description: noFlinkEnvironment.id,
    });

    const result = await ccloudEnvironmentQuickPick(undefined);

    assert.strictEqual(result, noFlinkEnvironment);
  });

  it("should return undefined if no environment is selected", async function () {
    // User cancels the quickpick
    showQuickPickStub.resolves(undefined);

    const result = await ccloudEnvironmentQuickPick(undefined);

    assert.strictEqual(result, undefined);
  });

  it("should apply filter function when provided", async function () {
    const filter = (env: CCloudEnvironment) => env.flinkComputePools.length > 0;

    await ccloudEnvironmentQuickPick(filter);

    sinon.assert.calledOnce(showQuickPickStub);

    // Should have only offered the flinkable environment.
    const quickPickItems: vscode.QuickPickItem[] = showQuickPickStub.firstCall.args[0];
    assert.strictEqual(quickPickItems.length, 1);
    assert.strictEqual(quickPickItems[0].label, flinkableEnvironment.name);
  });

  it("flinkCcloudEnvironmentQuickPick() should call ccloudEnvironmentQuickPick with filter", async function () {
    await flinkCcloudEnvironmentQuickPick();

    sinon.assert.calledOnce(showQuickPickStub);

    // Should have only offered the flinkable environemnt.
    const quickPickItems: vscode.QuickPickItem[] = showQuickPickStub.firstCall.args[0];
    assert.strictEqual(quickPickItems.length, 1);
    assert.strictEqual(quickPickItems[0].label, flinkableEnvironment.name);
  });
});
