import assert from "assert";
import { describe, it } from "mocha";
import {
  createFlinkArtifact,
  TEST_CCLOUD_FLINK_ARTIFACT,
} from "../../tests/unit/testResources/flinkArtifact";
import { createFlinkArtifactToolTip, FlinkArtifactTreeItem } from "./flinkArtifact";

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
