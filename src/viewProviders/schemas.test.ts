import * as assert from "assert";
import * as vscode from "vscode";
import { TEST_CCLOUD_SCHEMA } from "../../tests/unit/testResources";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem } from "../models/schema";
import { SchemasViewProvider } from "./schemas";

describe("SchemasViewProvider methods", () => {
  let provider: SchemasViewProvider;

  before(() => {
    provider = SchemasViewProvider.getInstance();
  });

  it("getTreeItem() should return a SchemaTreeItem for a Schema instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SCHEMA);
    assert.ok(treeItem instanceof SchemaTreeItem);
  });

  it("getTreeItem() should pass ContainerTreeItems through directly", () => {
    const container = new ContainerTreeItem<Schema>(
      "test",
      vscode.TreeItemCollapsibleState.Collapsed,
      [TEST_CCLOUD_SCHEMA],
    );
    const treeItem = provider.getTreeItem(container);
    assert.deepStrictEqual(treeItem, container);
  });
});
