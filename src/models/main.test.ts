import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { ContainerTreeItem, IdItem } from "./main";
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
