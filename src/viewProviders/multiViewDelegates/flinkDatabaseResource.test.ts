import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { FlinkDatabaseResource } from "../../models/flinkDatabaseResource";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResource";

// not Flink Database specific
const fakeResource = {
  connectionId: CCLOUD_CONNECTION_ID,
  connectionType: ConnectionType.Ccloud,
  id: "Resource1",
  searchableText: () => "",
};

describe("viewProviders/multiViewDelegates/flinkDatabaseResource", () => {
  describe("FlinkDatabaseResource", () => {
    describe("constructor", () => {
      const testResources: FlinkDatabaseResource[] = [
        fakeResource,
        { ...fakeResource, id: "Resource2" },
      ] as FlinkDatabaseResource[];

      it("should create an instance with correct properties", () => {
        const label = "Test Database";

        const item = new FlinkDatabaseResourceContainer(label, testResources);

        assert.strictEqual(item.label, label);
        assert.deepStrictEqual(item.children, testResources);
        assert.strictEqual(item.id, `${item.connectionId}-${label}`);
      });

      it("should set collapsible state based on length of `.children`", () => {
        const label = "Test Database";

        const withChildren = new FlinkDatabaseResourceContainer(label, testResources);
        assert.strictEqual(withChildren.collapsibleState, TreeItemCollapsibleState.Collapsed);

        const withoutChildren = new FlinkDatabaseResourceContainer(label, []);
        assert.strictEqual(withoutChildren.collapsibleState, TreeItemCollapsibleState.None);
      });

      it("should set description to number of children", () => {
        const label = "Test Database";

        const withChildren = new FlinkDatabaseResourceContainer(label, testResources);
        assert.strictEqual(withChildren.description, `(${testResources.length})`);

        const emptyResources: FlinkDatabaseResource[] = [];
        const withoutChildren = new FlinkDatabaseResourceContainer(label, emptyResources);
        assert.strictEqual(withoutChildren.description, `(${emptyResources.length})`);
      });
    });

    describe("searchableText", () => {
      it("should return the label as searchable text", () => {
        const label = "Searchable Database Resource";
        const resources: FlinkDatabaseResource[] = [];

        const item = new FlinkDatabaseResourceContainer(label, resources);

        const searchableText = item.searchableText();
        assert.strictEqual(searchableText, label);
      });
    });
  });
});
