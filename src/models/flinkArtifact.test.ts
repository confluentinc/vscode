import assert from "assert";
import { describe, it } from "mocha";
import {
  createFlinkArtifact,
  TEST_CCLOUD_FLINK_ARTIFACT,
} from "../../tests/unit/testResources/flinkArtifact";
import { createFlinkArtifactToolTip, FlinkArtifactTreeItem } from "./flinkArtifact";

describe("FlinkArtifact", () => {
  it("should convert date strings to Date objects when rehydrating from cache", () => {
    // simulate when dates are stored as strings after JSON.stringify() when retrieved from cache
    const original = createFlinkArtifact({ id: "test" });
    const deserialized = JSON.parse(JSON.stringify(original));

    assert.strictEqual(typeof deserialized.metadata.created_at, "string");
    assert.strictEqual(typeof deserialized.metadata.updated_at, "string");

    // constructor should convert strings back to Date objects
    const rehydrated = createFlinkArtifact(deserialized);
    assert.ok(rehydrated.createdAt instanceof Date);
    assert.ok(rehydrated.updatedAt instanceof Date);
    assert.strictEqual(rehydrated.createdAt?.toISOString(), original.createdAt?.toISOString());
    assert.strictEqual(rehydrated.updatedAt?.toISOString(), original.updatedAt?.toISOString());

    const localeString = rehydrated.createdAt?.toLocaleString(undefined, {
      timeZoneName: "short",
    });
    assert.notStrictEqual(localeString, rehydrated.createdAt?.toISOString());
  });
});

describe("FlinkArtifactTreeItem", () => {
  it("should have the correct context value", () => {
    const treeItem = new FlinkArtifactTreeItem(TEST_CCLOUD_FLINK_ARTIFACT);
    assert.strictEqual(treeItem.contextValue, "ccloud-flink-artifact");
  });

  describe("createFlinkArtifactToolTip", () => {
    it("should return a CustomMarkdownString with all artifact details", () => {
      const artifact = createFlinkArtifact({ documentationLink: "https://confluent.io" });
      const tooltip = createFlinkArtifactToolTip(artifact);
      const tooltipValue = tooltip.value;

      assert.strictEqual(typeof tooltipValue, "string");
      assert.match(tooltipValue, /Description: `Test artifact description`/);
      assert.match(tooltipValue, /\[See Documentation\]\(https:\/\/confluent\.io\)/);
    });

    it("should return a CustomMarkdownString with no documentation link", () => {
      const tooltip = createFlinkArtifactToolTip(TEST_CCLOUD_FLINK_ARTIFACT);
      const tooltipValue = tooltip.value;

      assert.strictEqual(typeof tooltipValue, "string");
      assert.match(tooltipValue, /\[No documentation link\]\(\)/);
    });
  });
});
