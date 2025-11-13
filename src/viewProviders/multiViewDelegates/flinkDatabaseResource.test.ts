import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { IdItem } from "../../models/main";
import type { IResourceBase, ISearchable } from "../../models/resource";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResource";

// not Flink Database specific
const fakeResource: IResourceBase & IdItem & ISearchable = {
  connectionId: CCLOUD_CONNECTION_ID,
  connectionType: ConnectionType.Ccloud,
  id: "Resource1",
  searchableText: () => "",
};

describe("viewProviders/multiViewDelegates/flinkDatabaseResource", () => {
  describe("FlinkDatabaseResource", () => {
    describe("constructor", () => {
      it("should create an instance with correct properties", () => {
        const label = "Test Database";

        const resources = [fakeResource, { ...fakeResource, id: "Resource2" }];

        const item = new FlinkDatabaseResourceContainer(label, resources);

        assert.strictEqual(item.label, label);
        assert.deepStrictEqual(item.children, resources);
        assert.strictEqual(item.id, `${item.connectionId}-${label}`);
      });

      it("should set collapsible state based on length of `.children`", () => {
        const label = "Test Database";

        const withChildren = new FlinkDatabaseResourceContainer(label, [fakeResource]);
        assert.strictEqual(withChildren.collapsibleState, TreeItemCollapsibleState.Collapsed);

        const withoutChildren = new FlinkDatabaseResourceContainer(label, []);
        assert.strictEqual(withoutChildren.collapsibleState, TreeItemCollapsibleState.None);
      });
    });

    describe("searchableText", () => {
      it("should return the label as searchable text", () => {
        const label = "Searchable Database Resource";
        const resources: (IResourceBase & IdItem & ISearchable)[] = [];

        const item = new FlinkDatabaseResourceContainer(label, resources);

        const searchableText = item.searchableText();
        assert.strictEqual(searchableText, label);
      });
    });
  });
});
