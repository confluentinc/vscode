import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { IconNames } from "../constants";
import { ContainerTreeItem, CustomMarkdownString, IdItem, KeyValuePairArray } from "./main";
import { ISearchable } from "./resource";

/** Mock class to be used as a child of a {@link ContainerTreeItem} for testing. */
class MockContainerChild implements IdItem, ISearchable {
  constructor(public id: string) {}
  searchableText(): string {
    return this.id;
  }
}

describe("ContainerTreeItem tests", () => {
  it("ContainerTreeItem constructor likes items with distinct ids", () => {
    const children = [
      new MockContainerChild("1"),
      new MockContainerChild("2"),
      new MockContainerChild("3"),
    ];
    const container = new ContainerTreeItem("label", TreeItemCollapsibleState.Collapsed, children);
    assert.strictEqual(container.children.length, 3);
  });

  it("searchableText()", () => {
    const stringLabelContainer = new ContainerTreeItem(
      "string label",
      TreeItemCollapsibleState.Collapsed,
      [],
    );
    assert.strictEqual(stringLabelContainer.searchableText(), "string label (0)");

    // test branch where label is a TreeItemLabel
    const treeItemLabel = { label: "tree item label" };
    const treeItemLabelContainer = new ContainerTreeItem(
      treeItemLabel,
      TreeItemCollapsibleState.Collapsed,
      [],
    );
    assert.strictEqual(treeItemLabelContainer.searchableText(), "tree item label (0)");
  });

  it("ContainerTreeItem constructor throws on duplicate ids", () => {
    const children = [new MockContainerChild("1"), new MockContainerChild("1")];
    assert.throws(
      () => new ContainerTreeItem("label", TreeItemCollapsibleState.Collapsed, children),
    );
  });

  it("ContainerTreeItem children setter likes items with distinct ids", () => {
    const container = new ContainerTreeItem<MockContainerChild>(
      "label",
      TreeItemCollapsibleState.Collapsed,
      [],
    );
    container.children = [
      new MockContainerChild("1"),
      new MockContainerChild("2"),
      new MockContainerChild("3"),
    ];
    assert.strictEqual(container.children.length, 3);
  });

  it("ContainerTreeItem children setter throws on duplicate ids", () => {
    const container = new ContainerTreeItem<MockContainerChild>(
      "label",
      TreeItemCollapsibleState.Collapsed,
      [],
    );
    const children = [new MockContainerChild("1"), new MockContainerChild("1")];
    assert.throws(() => (container.children = children));
  });
});

describe("CustomMarkdownString tests", () => {
  describe("resourceTooltip", () => {
    it("title line should include icon if provided", () => {
      const iconName = IconNames.TOPIC;
      const title = "MyResource";
      const markdownString = CustomMarkdownString.resourceTooltip(title, iconName, undefined, []);
      assert.ok(markdownString.value.startsWith(`#### $(${iconName}) ${title}\n`));
    });

    it("title line omits icon if not provided", () => {
      const title = "MyResource";
      const markdownString = CustomMarkdownString.resourceTooltip(title, undefined, undefined, []);
      assert.ok(markdownString.value.startsWith(`#### ${title}\n`));
    });

    it("includes truthy key + value pairs, skips empty values", () => {
      const keyValuePairs: KeyValuePairArray = [
        ["Key1", "Value1"],
        ["Key2", "Value2"],
        ["Key3", undefined], // should be skipped.
        ["Key4", ""], // should be skipped.
      ];

      const markdownString = CustomMarkdownString.resourceTooltip(
        "MyResource",
        undefined,
        undefined,
        keyValuePairs,
      );
      assert.ok(markdownString.value.includes("Key1: `Value1`"));
      assert.ok(markdownString.value.includes("Key2: `Value2`"));
      assert.ok(!markdownString.value.includes("Key3:"));
      assert.ok(!markdownString.value.includes("Key4:"));
    });

    it("includes ccloudUrl if provided", () => {
      const ccloudUrl = "https://ccloud.confluent.cloud/resource";
      const markdownString = CustomMarkdownString.resourceTooltip(
        "MyResource",
        undefined,
        ccloudUrl,
        [],
      );
      assert.ok(
        markdownString.value.includes(
          `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudUrl})`,
        ),
      );
    });

    it("throws on invalid ccloudUrl", () => {
      const invalidUrl = "invalid-url";
      assert.throws(() => {
        CustomMarkdownString.resourceTooltip("MyResource", undefined, invalidUrl, []);
      }, /Invalid URL/);
    });
  });
});
