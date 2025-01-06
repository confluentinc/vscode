import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { ContainerTreeItem } from "./main";

class MockIdItem {
  constructor(public id: string) {}
}

class MockContainerTreeItem extends ContainerTreeItem<MockIdItem> {
  constructor(label: string, children: MockIdItem[]) {
    super(label, TreeItemCollapsibleState.Collapsed, children);
  }
}

describe("ContainerTreeItem tests", () => {
  it("ContainerTreeItem constructor likes items with distinct ids", () => {
    const children = [new MockIdItem("1"), new MockIdItem("2"), new MockIdItem("3")];
    const container = new MockContainerTreeItem("label", children);
    assert.strictEqual(container.children.length, 3);
  });

  it("ContainerTreeItem constructor throws on duplicate ids", () => {
    const children = [new MockIdItem("1"), new MockIdItem("1")];
    assert.throws(() => new MockContainerTreeItem("label", children));
  });

  it("ContainerTreeItem children setter likes items with distinct ids", () => {
    const container = new MockContainerTreeItem("label", []);
    const children = [new MockIdItem("1"), new MockIdItem("2"), new MockIdItem("3")];
    container.children = children;
    assert.strictEqual(container.children.length, 3);
  });

  it("ContainerTreeItem children setter throws on duplicate ids", () => {
    const container = new MockContainerTreeItem("label", []);
    const children = [new MockIdItem("1"), new MockIdItem("1")];
    assert.throws(() => (container.children = children));
  });
});
