import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
  TEST_CCLOUD_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { IconNames } from "../constants";
import { FLINK_CONFIG_COMPUTE_POOL } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import * as notifications from "../notifications";
import { flinkComputePoolQuickPick } from "./flinkComputePools";

describe("quickpicks/flinkComputePools.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let showQuickPickStub: sinon.SinonStub;
  let stubbedConfigs: StubbedWorkspaceConfiguration;
  let stubbedCcloudResourceLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

  const TEST_CCLOUD_FLINK_COMPUTE_POOL_2_ID = "lfcp-some-other-id";
  const TEST_CCLOUD_FLINK_COMPUTE_POOL_2 = new CCloudFlinkComputePool({
    name: "ccloud-pool2",
    provider: TEST_CCLOUD_PROVIDER,
    region: TEST_CCLOUD_REGION,
    maxCfu: 10,
    environmentId: TEST_CCLOUD_ENVIRONMENT_ID,
    id: TEST_CCLOUD_FLINK_COMPUTE_POOL_2_ID,
  });

  // This needs a home. We have a couple of tests declaring similar things in other files.
  const TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_SR_AND_FLINK = new CCloudEnvironment({
    ...TEST_CCLOUD_ENVIRONMENT,
    kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
    flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL_2],
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
    stubbedCcloudResourceLoader = getStubbedCCloudResourceLoader(sandbox);
    // logged into ccloud with an env that has a single flink compute pool
    // by default.
    stubbedCcloudResourceLoader.getEnvironments.resolves([
      TEST_CCLOUD_ENVIRONMENT_WITH_KAFKA_AND_SR_AND_FLINK,
    ]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  /** Strip away the annoying kind=Separator items passed into showQuickPick */
  function extractPoolItemsFromQuickPickCall(): vscode.QuickPickItem[] {
    sinon.assert.calledOnce(showQuickPickStub);
    const quickPickItems = showQuickPickStub.firstCall.args[0] as vscode.QuickPickItem[];
    return quickPickItems.filter((item) => item.kind !== vscode.QuickPickItemKind.Separator);
  }

  describe("flinkComputePoolQuickPick()", () => {
    it("should prompt the user to sign in if not signed in to ccloud", async () => {
      // simulate not being signed in to ccloud
      stubbedCcloudResourceLoader.getEnvironments.resolves([]);
      const showInfoNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showInfoNotificationWithButtons",
      );

      await flinkComputePoolQuickPick();
      sinon.assert.calledOnce(showInfoNotificationWithButtonsStub);
      const callArgs = showInfoNotificationWithButtonsStub.firstCall.args;
      assert.strictEqual(callArgs[0], "No Flink compute pools available.");
    });

    it("should return the selected pool", async () => {
      // simulate user selecting the second pool in the list
      showQuickPickStub.resolves({
        label: TEST_CCLOUD_FLINK_COMPUTE_POOL_2.name,
        description: TEST_CCLOUD_FLINK_COMPUTE_POOL_2.id,
        value: TEST_CCLOUD_FLINK_COMPUTE_POOL_2,
      });

      const selectedPool = await flinkComputePoolQuickPick();
      assert.deepStrictEqual(selectedPool, TEST_CCLOUD_FLINK_COMPUTE_POOL_2);
    });

    it("should call and honor predicate if provided", async () => {
      const predicate = sandbox.spy(
        // we hate TEST_CCLOUD_FLINK_COMPUTE_POOL and want it filtered out.
        (pool: CCloudFlinkComputePool) => pool.id !== TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      );
      await flinkComputePoolQuickPick(null, predicate);
      sinon.assert.calledTwice(predicate);

      // and should have only let TEST_CCLOUD_FLINK_COMPUTE_POOL_2 through
      const quickPickItems = extractPoolItemsFromQuickPickCall();
      assert.strictEqual(quickPickItems.length, 1);
      const onlyPool = quickPickItems[0];
      assert.strictEqual(onlyPool.description, TEST_CCLOUD_FLINK_COMPUTE_POOL_2_ID);
    });

    for (const preferredPool of [
      TEST_CCLOUD_FLINK_COMPUTE_POOL,
      TEST_CCLOUD_FLINK_COMPUTE_POOL_2,
    ]) {
      it(`If user has default compute pool set, but not called with a selected pool, the default should be at the top of the list: ${preferredPool.id}`, async () => {
        stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, preferredPool.id);

        // We're not testing the quickpick result here, just the generation of items passed into showQuickPickStub
        await flinkComputePoolQuickPick();

        const quickPickItems = extractPoolItemsFromQuickPickCall();
        assert.strictEqual(quickPickItems.length, 2);
        const firstItem = quickPickItems[0];
        // The pool's id is in the description field.
        assert.strictEqual(firstItem.description, preferredPool.id);
      });

      it(`If user has default compute pool set, and called with that selected pool, the default/selected should be at the top of the list and not duplicated: ${preferredPool.id}`, async () => {
        stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, preferredPool.id);

        // We're not testing the quickpick result here, just the generation of items passed into showQuickPickStub
        await flinkComputePoolQuickPick(preferredPool);

        const quickPickItems = extractPoolItemsFromQuickPickCall();
        assert.strictEqual(quickPickItems.length, 2);
        const firstItem = quickPickItems[0];
        // The pool's id is in the description field.
        assert.strictEqual(firstItem.description, preferredPool.id);
        // Should use icon checked
        assert.strictEqual((firstItem.iconPath as vscode.ThemeIcon).id, IconNames.CURRENT_RESOURCE);

        // the second item should be the other pool
        const secondItem = quickPickItems[1];
        const secondPool =
          preferredPool === TEST_CCLOUD_FLINK_COMPUTE_POOL
            ? TEST_CCLOUD_FLINK_COMPUTE_POOL_2
            : TEST_CCLOUD_FLINK_COMPUTE_POOL;
        assert.strictEqual(secondItem.description, secondPool.id);
        // and should use the pool's own icon, not the 'selected' icon
        assert.strictEqual((secondItem.iconPath as vscode.ThemeIcon).id, secondPool.iconName);
      });

      it(`If user has default compute pool set, and called with a different selected pool, the selected should be at the top of the list and the default should be second: ${preferredPool.id}`, async () => {
        stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, preferredPool.id);
        // invert which pool is passed as selected
        const selectedPool =
          preferredPool === TEST_CCLOUD_FLINK_COMPUTE_POOL
            ? TEST_CCLOUD_FLINK_COMPUTE_POOL_2
            : TEST_CCLOUD_FLINK_COMPUTE_POOL;

        // We're not testing the quickpick result here, just the generation of items passed into showQuickPickStub
        await flinkComputePoolQuickPick(selectedPool);

        const quickPickItems = extractPoolItemsFromQuickPickCall();
        assert.strictEqual(quickPickItems.length, 2);
        const firstItem = quickPickItems[0];
        // The pool's id is in the description field.
        assert.strictEqual(firstItem.description, selectedPool.id);
        // Should use icon checked
        assert.strictEqual((firstItem.iconPath as vscode.ThemeIcon).id, IconNames.CURRENT_RESOURCE);

        // the second item should be the other pool
        const secondItem = quickPickItems[1];
        assert.strictEqual(secondItem.description, preferredPool.id);
        // and should use the pool's own icon, not the 'selected' icon
        assert.strictEqual((secondItem.iconPath as vscode.ThemeIcon).id, preferredPool.iconName);
      });
    }
  });
});
