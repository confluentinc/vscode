import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
} from "../../../tests/unit/testResources";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../../constants";
import type { FlinkDatabaseResource } from "../../models/flinkDatabaseResource";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResourceContainer";

/**
 * Create a general-purpose {@link FlinkDatabaseResource} object.
 * This will return only the core/shared properties of the database resource types to help test
 * the {@link FlinkDatabaseResourceContainer} class.
 */
function createFakeFlinkDatabaseResource(
  options?: Partial<Omit<FlinkDatabaseResource, "connectionId" | "connectionType">>,
): FlinkDatabaseResource {
  return {
    // these won't change until we support other connection types:
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    // database details:
    environmentId: options?.environmentId ?? TEST_CCLOUD_ENVIRONMENT_ID,
    provider: options?.provider ?? TEST_CCLOUD_PROVIDER,
    region: options?.region ?? TEST_CCLOUD_REGION,
    databaseId: options?.databaseId ?? TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
    // base resource details:
    id: options?.id ?? "Resource1",
    name: options?.name ?? "Test Resource",
    iconName: options?.iconName ?? IconNames.PLACEHOLDER,
    searchableText: options?.searchableText ?? (() => ""),
  };
}

describe("viewProviders/multiViewDelegates/flinkDatabaseResourceContainer", () => {
  describe("FlinkDatabaseResourceContainer", () => {
    describe("constructor", () => {
      const testResources: FlinkDatabaseResource[] = [
        createFakeFlinkDatabaseResource(),
        createFakeFlinkDatabaseResource({ id: "Resource2" }),
      ];

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
