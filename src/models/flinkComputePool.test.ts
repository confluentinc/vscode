import * as assert from "assert";
import { ThemeIcon, TreeItemCollapsibleState } from "vscode";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { IconNames } from "../constants";
import {
  CCloudFlinkComputePool,
  FlinkComputePoolTreeItem,
  createFlinkComputePoolTooltip,
} from "./flinkComputePool";

describe("models/flinkComputePool.ts CCloudFlinkComputePool", () => {
  it("should generate the correct ccloudUrl", () => {
    const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

    assert.strictEqual(
      pool.ccloudUrl,
      `https://confluent.cloud/environments/${pool.environmentId}/flink/pools/${pool.id}/overview`,
    );
  });

  it("should generate correct searchableText", () => {
    const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

    assert.strictEqual(pool.searchableText(), `${pool.name} ${pool.id}`);
  });
});

describe("models/flinkComputePool.ts FlinkComputePoolTreeItem", () => {
  it("should create correct tree item for CCloud Flink pool", () => {
    const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

    const treeItem = new FlinkComputePoolTreeItem(pool);

    // internal properties
    assert.strictEqual(treeItem.id, `${pool.connectionId}-${pool.id}`);
    assert.strictEqual(
      treeItem.contextValue,
      `${pool.connectionType.toLowerCase()}-flink-compute-pool`,
    );
    // user-facing properties
    assert.strictEqual(treeItem.label, pool.name);
    assert.strictEqual(treeItem.description, pool.id);
    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.None);
    assert.deepStrictEqual(treeItem.iconPath, new ThemeIcon(IconNames.FLINK_COMPUTE_POOL));
  });
});

describe("models/flinkComputePool.ts createFlinkComputePoolTooltip", () => {
  it("should include basic info for a Flink compute pool", () => {
    // TODO: revisit this once we have non-CCloud compute pool models
    const tooltip = createFlinkComputePoolTooltip(TEST_CCLOUD_FLINK_COMPUTE_POOL);

    assert.ok(tooltip.value.includes("Flink Compute Pool"));
    assert.ok(tooltip.value.includes(`ID: \`${TEST_CCLOUD_FLINK_COMPUTE_POOL.id}\``));
    assert.ok(tooltip.value.includes(`Name: \`${TEST_CCLOUD_FLINK_COMPUTE_POOL.name}\``));
  });

  it("should include CCloud-specific info for a CCloud Flink compute pool", () => {
    const tooltip = createFlinkComputePoolTooltip(TEST_CCLOUD_FLINK_COMPUTE_POOL);

    assert.ok(tooltip.value.includes(`Provider: \`${TEST_CCLOUD_FLINK_COMPUTE_POOL.provider}\``));
    assert.ok(tooltip.value.includes(`Region: \`${TEST_CCLOUD_FLINK_COMPUTE_POOL.region}\``));
    assert.ok(tooltip.value.includes(`Max CFU: \`${TEST_CCLOUD_FLINK_COMPUTE_POOL.maxCfu}\``));
    assert.ok(tooltip.value.includes("Open in Confluent Cloud"));
    assert.ok(tooltip.value.includes(TEST_CCLOUD_FLINK_COMPUTE_POOL.ccloudUrl));
  });
});
