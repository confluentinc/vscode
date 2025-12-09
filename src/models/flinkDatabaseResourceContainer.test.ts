import * as assert from "assert";
import type { ThemeIcon } from "vscode";
import { TreeItemCollapsibleState } from "vscode";
import { createFakeFlinkDatabaseResource } from "../../tests/unit/testResources/flinkDatabaseResource";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import type { FlinkDatabaseResource } from "./flinkDatabaseResource";
import { FlinkDatabaseResourceContainer } from "./flinkDatabaseResourceContainer";

describe("models/flinkDatabaseResourceContainer", () => {
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
        assert.strictEqual(item.connectionId, CCLOUD_CONNECTION_ID);
        assert.strictEqual(item.connectionType, ConnectionType.Ccloud);
        assert.strictEqual(item.id, `${item.connectionId}-${label}`);
      });

      it("should always set the collapsible state to Collapsed", () => {
        const label = "Test Database";

        const withChildren = new FlinkDatabaseResourceContainer(label, testResources);
        assert.strictEqual(withChildren.collapsibleState, TreeItemCollapsibleState.Collapsed);

        const withoutChildren = new FlinkDatabaseResourceContainer(label, []);
        assert.strictEqual(withoutChildren.collapsibleState, TreeItemCollapsibleState.Collapsed);
      });

      it("should update description when `children` is set", () => {
        const label = "Test Database";

        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>(label, []);
        // description is not set in constructor (before loading)
        assert.strictEqual(container.description, undefined);

        // but is set when children is set
        container.children = testResources;
        assert.strictEqual(container.description, `(${testResources.length})`);

        // and updates when children change
        container.children = [];
        assert.strictEqual(container.description, `(0)`);
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

    describe("isLoading", () => {
      it("should start with isLoading set to false", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);

        assert.strictEqual(container.isLoading, false);
      });

      it("should adjust .iconPath based on the value of isLoading", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);

        container.isLoading = true;
        assert.ok(container.iconPath);
        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.LOADING);

        container.isLoading = false;
        assert.strictEqual(container.iconPath, undefined);
      });

      it("should clear isLoading state when children are set", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);
        container.isLoading = true;

        const testResources = [createFakeFlinkDatabaseResource()];
        container.children = testResources;

        assert.strictEqual(container.isLoading, false);
      });
    });

    describe("hasError", () => {
      it("should start with hasError set to false", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);

        assert.strictEqual(container.hasError, false);
      });

      it("should adjust .iconPath based on the value of hasError", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);

        container.hasError = true;
        assert.ok(container.iconPath);
        assert.strictEqual((container.iconPath as ThemeIcon).id, "warning");
        assert.strictEqual(
          (container.iconPath as ThemeIcon).color!.id,
          "problemsErrorIcon.foreground",
        );

        container.hasError = false;
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.iconPath, undefined);
      });

      it("should not modify .contextValue when no original contextValue was provided in the constructor", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);

        container.hasError = true;
        assert.strictEqual(container.contextValue, undefined);

        container.hasError = false;
        assert.strictEqual(container.contextValue, undefined);
      });

      it("should toggle the contextValue between error and non-error states without suffix duplication", () => {
        const contextValue = "flinkDatabase.container";
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>(
          "Test",
          [],
          contextValue,
        );

        container.hasError = true;
        assert.strictEqual(container.contextValue, `${contextValue}-error`);

        container.hasError = false;
        assert.strictEqual(container.contextValue, contextValue);

        container.hasError = true;
        assert.strictEqual(container.contextValue, `${contextValue}-error`);
      });
    });

    describe("state interactions", () => {
      it("should settle loading state and description when setting children", () => {
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>("Test", []);
        container.isLoading = true;

        const testResources = [createFakeFlinkDatabaseResource()];
        container.children = testResources;

        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.description, "(1)");
        assert.strictEqual(container.iconPath, undefined);
      });

      it("should clear hasError when setting non-empty children", () => {
        const contextValue = "flinkDatabase.container";
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>(
          "Test",
          [],
          contextValue,
        );
        container.hasError = true;

        const testResources = [createFakeFlinkDatabaseResource()];
        container.children = testResources;

        // hasError is cleared when we have successful results
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.description, "(1)");
        assert.strictEqual(container.iconPath, undefined);
        assert.strictEqual(container.contextValue, contextValue);
      });

      it("should not clear hasError when setting empty children array", () => {
        const contextValue = "flinkDatabase.container";
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>(
          "Test",
          [],
          contextValue,
        );
        container.hasError = true;

        container.children = [];

        // hasError persists when children array is empty (no successful results)
        assert.strictEqual(container.hasError, true);
        assert.strictEqual(container.description, "(0)");
        assert.strictEqual(container.contextValue, `${contextValue}-error`);
      });

      it("should handle multiple state transitions", () => {
        const contextValue = "flinkDatabase.container";
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>(
          "Test",
          [],
          contextValue,
        );
        // simulate initial loading
        container.isLoading = true;
        assert.ok(container.iconPath);

        // set error
        container.hasError = true;
        assert.strictEqual(container.contextValue, `${contextValue}-error`);
        assert.ok(container.iconPath);

        // set children with items (clears loading, error, and iconPath)
        container.children = [createFakeFlinkDatabaseResource()];
        assert.strictEqual(container.isLoading, false);
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.contextValue, contextValue);
        assert.strictEqual(container.iconPath, undefined);
      });

      it("should handle error recovery with empty then non-empty children", () => {
        const contextValue = "flinkDatabase.container";
        const container = new FlinkDatabaseResourceContainer<FlinkDatabaseResource>(
          "Test",
          [],
          contextValue,
        );

        // set error and empty children (error persists)
        container.hasError = true;
        container.children = [];
        assert.strictEqual(container.hasError, true);
        assert.strictEqual(container.contextValue, `${contextValue}-error`);

        // then set non-empty children (error clears)
        container.children = [createFakeFlinkDatabaseResource()];
        assert.strictEqual(container.hasError, false);
        assert.strictEqual(container.contextValue, contextValue);
      });
    });
  });
});
