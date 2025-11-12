import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { IdItem } from "../../models/main";
import type { IResourceBase, ISearchable } from "../../models/resource";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResource";

describe("viewProviders/multiViewDelegates/flinkDatabaseResource", () => {
  describe("FlinkDatabaseResource", () => {
    describe("constructor", () => {
      it("should create an instance with correct properties", () => {
        const label = "Test Database";
        const collapsibleState = TreeItemCollapsibleState.Collapsed;
        // fake base resources, not Flink Database specific
        const fakeResource: IResourceBase & IdItem & ISearchable = {
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          id: "Resource1",
          searchableText: () => "",
        };
        const resources = [fakeResource, { ...fakeResource, id: "Resource2" }];

        const item = new FlinkDatabaseResourceContainer(label, collapsibleState, resources);

        assert.strictEqual(item.label, label);
        assert.strictEqual(item.collapsibleState, collapsibleState);
        assert.deepStrictEqual(item.children, resources);
        assert.strictEqual(item.id, `${item.connectionId}-${label}`);
      });
    });

    describe("searchableText", () => {
      it("should return the label as searchable text", () => {
        const label = "Searchable Database Resource";
        const collapsibleState = TreeItemCollapsibleState.Collapsed;
        const resources: (IResourceBase & IdItem & ISearchable)[] = [];

        const item = new FlinkDatabaseResourceContainer(label, collapsibleState, resources);

        const searchableText = item.searchableText();
        assert.strictEqual(searchableText, label);
      });
    });
  });
});
