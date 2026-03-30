/**
 * Test suite for FlinkTypeNode.
 * Tests the parsed type node for display in the TreeView.
 */

import assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { IconNames } from "../icons";
import { FlinkTypeKind } from "./flinkTypes";
import { FlinkTypeNode } from "./flinkTypeNode";
import { FlinkRelationColumn } from "./flinkRelation";
import { parseFlinkType } from "../parsers/flinkTypeParser";
import type { CustomMarkdownString } from "./main";

/**
 * Helper to create a test FlinkRelationColumn.
 */
function createTestColumn(fullDataType: string, name: string = "test_col"): FlinkRelationColumn {
  return new FlinkRelationColumn({
    relationName: "test_table",
    name,
    fullDataType,
    isNullable: true,
    distributionKeyNumber: null,
    isGenerated: false,
    isPersisted: true,
    isHidden: false,
    metadataKey: null,
    comment: null,
  });
}

describe("FlinkTypeNode", () => {
  describe("constructor and properties", () => {
    it("creates node with minimal properties", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.parsedType, parsed);
      assert.strictEqual(node.id, "test-table.test-col");
    });
  });

  describe("IResourceBase implementation", () => {
    it("has correct connectionId", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.connectionId, CCLOUD_CONNECTION_ID);
    });

    it("has correct connectionType", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.connectionType, "CCLOUD");
    });
  });

  describe("id property", () => {
    it("returns the id that was passed in constructor", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.id, "test-table.test-col");
    });

    it("returns different ids for different node instances", () => {
      const parsed = parseFlinkType("INT");
      const node1 = new FlinkTypeNode({
        parsedType: parsed,
        id: "table1.col1",
      });
      const node2 = new FlinkTypeNode({
        parsedType: parsed,
        id: "table2.col2",
      });

      assert.strictEqual(node1.id, "table1.col1");
      assert.strictEqual(node2.id, "table2.col2");
      assert.notStrictEqual(node1.id, node2.id);
    });

    it("uses field name in id structure for ROW field nodes", () => {
      const column = new FlinkRelationColumn({
        ...createTestColumn("ARRAY<ROW<id INT>>"),
        name: "artists",
        fullDataType: "ARRAY<ROW<id INT>>",
      });

      // Get children from the column - they are the ROW fields
      const children = column.getChildren();
      assert.strictEqual(children.length, 1, "Should have 1 field child (id)");

      // The id should be: table.columnName.[array].fieldName
      // Column ID is "test_table.artists", add synthetic segment and field name "id"
      assert.strictEqual(children[0].id, "test_table.artists.[array].id");
    });

    it("uses field name in id structure for MULTISET element nodes", () => {
      const column = new FlinkRelationColumn({
        ...createTestColumn("MULTISET<ROW<id INT>>"),
        name: "items",
        fullDataType: "MULTISET<ROW<id INT>>",
      });

      const children = column.getChildren();
      assert.strictEqual(children.length, 1, "Should have 1 field child (id)");

      // The id should be: table.columnName.[multiset].fieldName
      // Column ID is "test_table.items", add synthetic segment and field name "id"
      assert.strictEqual(children[0].id, "test_table.items.[multiset].id");
    });
  });

  describe("isExpandable property", () => {
    it("returns false for scalar types", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, false);
    });

    it("returns true for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns true for MAP types", () => {
      const parsed = parseFlinkType("MAP<VARCHAR, INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns false for ARRAY<scalar>", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, false);
    });

    it("returns true for ARRAY<ROW>", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT, name VARCHAR>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns true for ARRAY<MAP>", () => {
      const parsed = parseFlinkType("ARRAY<MAP<VARCHAR, INT>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns false for MULTISET<scalar>", () => {
      const parsed = parseFlinkType("MULTISET<VARCHAR>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, false);
    });

    it("returns true for MULTISET<ROW>", () => {
      const parsed = parseFlinkType("MULTISET<ROW<id INT>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns true for nested ARRAY<ARRAY<ROW>>", () => {
      const parsed = parseFlinkType("ARRAY<ARRAY<ROW<id INT>>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, true);
    });
  });

  describe("getChildren()", () => {
    it("returns empty array for scalar types", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      const children = node.getChildren();
      assert.strictEqual(children.length, 0);
    });

    it("returns member nodes for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR>");
      const column = createTestColumn("ROW<id INT, name VARCHAR>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      const children = node.getChildren();
      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].parsedType.fieldName, "id");
      assert.strictEqual(children[1].parsedType.fieldName, "name");
    });

    it("returns ROW fields directly for ARRAY<ROW> (skips intermediate)", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT, name VARCHAR>>");
      const column = createTestColumn("ARRAY<ROW<id INT, name VARCHAR>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      const children = node.getChildren();
      // Should return the ROW's fields directly, not the ROW itself
      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].parsedType.fieldName, "id");
      assert.strictEqual(children[0].parsedType.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(children[1].parsedType.fieldName, "name");
    });

    it("returns key and value nodes for MAP types", () => {
      const parsed = parseFlinkType("MAP<VARCHAR, INT>");
      const column = createTestColumn("MAP<VARCHAR, INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      const children = node.getChildren();
      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].parsedType.fieldName, "key");
      assert.strictEqual(children[1].parsedType.fieldName, "value");
    });

    it("returns empty array for ARRAY<scalar>", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const column = createTestColumn("ARRAY<INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      const children = node.getChildren();
      assert.strictEqual(children.length, 0);
    });
  });

  describe("getChildren() caching", () => {
    it("returns exact same object instances on consecutive calls for ROW children", () => {
      const rowType = parseFlinkType("ROW<id INT, name VARCHAR, active BOOLEAN>");
      const node = new FlinkTypeNode({
        parsedType: rowType,
        id: "test.table.column",
      });

      const children1 = node.getChildren();
      const children2 = node.getChildren();

      // Verify same array instance
      assert.strictEqual(
        children1,
        children2,
        "getChildren() should return the exact same array instance on consecutive calls",
      );

      // Verify same child node instances
      assert.strictEqual(children1.length, 3, "Should have 3 children");
      for (let i = 0; i < children1.length; i++) {
        assert.strictEqual(
          children1[i],
          children2[i],
          `Child ${i} should be the exact same instance (not just equal)`,
        );
      }
    });

    it("returns exact same object instances on consecutive calls for ARRAY<ROW> children", () => {
      const arrayType = parseFlinkType("ARRAY<ROW<id INT, status VARCHAR>>");
      const node = new FlinkTypeNode({
        parsedType: arrayType,
        id: "test.table.array_col",
      });

      const children1 = node.getChildren();
      const children2 = node.getChildren();

      // Verify same array instance
      assert.strictEqual(
        children1,
        children2,
        "getChildren() should return the exact same array instance on consecutive calls",
      );

      // Verify same child node instances
      assert.strictEqual(children1.length, 2, "Should have 2 children from ROW<>");
      for (let i = 0; i < children1.length; i++) {
        assert.strictEqual(
          children1[i],
          children2[i],
          `Child ${i} should be the exact same instance`,
        );
      }
    });
  });

  describe("iconName property", () => {
    it("should return FLINK_TYPE_ROW for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      assert.strictEqual(node.iconName, IconNames.FLINK_TYPE_ROW);
    });

    it("should return FLINK_TYPE_ARRAY for ARRAY types", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      assert.strictEqual(node.iconName, IconNames.FLINK_TYPE_ARRAY);
    });

    it("should return FLINK_TYPE_MULTISET for MULTISET types", () => {
      const parsed = parseFlinkType("MULTISET<VARCHAR>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      assert.strictEqual(node.iconName, IconNames.FLINK_TYPE_MULTISET);
    });

    it("should return FLINK_TYPE_MULTISET (not ARRAY) for MULTISET with ROW", () => {
      const parsed = parseFlinkType("MULTISET<ROW<id INT>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      assert.strictEqual(node.iconName, IconNames.FLINK_TYPE_MULTISET);
    });

    it("should return FLINK_FUNCTION for MAP types", () => {
      const parsed = parseFlinkType("MAP<INT, VARCHAR>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      assert.strictEqual(node.iconName, IconNames.FLINK_FUNCTION);
    });

    it("should return FLINK_FUNCTION for scalar types", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      assert.strictEqual(node.iconName, IconNames.FLINK_FUNCTION);
    });

    it("should distinguish ARRAY and MULTISET icons", () => {
      const arrayParsed = parseFlinkType("ARRAY<INT>");
      const multisetParsed = parseFlinkType("MULTISET<INT>");

      const arrayNode = new FlinkTypeNode({
        parsedType: arrayParsed,
        id: "test-table.test-col",
      });
      const multisetNode = new FlinkTypeNode({
        parsedType: multisetParsed,
        id: "test-table.test-col",
      });

      const arrayIcon = arrayNode.iconName;
      const multisetIcon = multisetNode.iconName;

      assert.strictEqual(arrayIcon, IconNames.FLINK_TYPE_ARRAY);
      assert.strictEqual(multisetIcon, IconNames.FLINK_TYPE_MULTISET);
      assert.notStrictEqual(arrayIcon, multisetIcon);
    });
  });

  describe("getTreeItem()", () => {
    it("creates tree item with correct label for scalar field", () => {
      const column = createTestColumn("INT");
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "test_field";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });
      const item = node.getTreeItem();

      assert.strictEqual(item.label, "test_field");
    });

    it("creates tree item with element type in label for ARRAY<scalar>", () => {
      const parsed = parseFlinkType("ARRAY<VARCHAR(255)>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      // formatSqlType only removes 2147483647, keeps other parameters
      assert.strictEqual(item.label, "VARCHAR(255)[]");
    });

    it("creates tree item with element type in label for ARRAY<ROW>", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert.strictEqual(item.label, "ROW[]");
    });

    it("creates tree item with element type in label for MULTISET<scalar>", () => {
      const parsed = parseFlinkType("MULTISET<INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert.strictEqual(item.label, "INT MULTISET");
    });

    it("sets collapsibleState to None for non-expandable types", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.None);
    });

    it("sets collapsibleState to Collapsed for expandable types", () => {
      const parsed = parseFlinkType("ROW<id INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.Collapsed);
    });

    it("includes description with type and nullability", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      parsed.isFieldNullable = false;

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert(item.description.includes("VARCHAR"));
      assert(item.description.includes("NOT NULL"));
    });

    it("omits NOT NULL in description for nullable types", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      parsed.isFieldNullable = true;

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert(!item.description.includes("NOT NULL"));
    });

    it("includes array notation in description for ARRAY<scalar>", () => {
      const parsed = parseFlinkType("ARRAY<VARCHAR(255)>");
      parsed.isFieldNullable = true;

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert.strictEqual(item.description, "VARCHAR(255)[]");
    });

    it("includes array notation in description for ARRAY<scalar> with NOT NULL", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      parsed.isFieldNullable = false;

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert.strictEqual(item.description, "INT[] NOT NULL");
    });

    it("includes multiset notation in description for MULTISET<scalar>", () => {
      const parsed = parseFlinkType("MULTISET<DECIMAL>");
      parsed.isFieldNullable = true;

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert.strictEqual(item.description, "DECIMAL MULTISET");
    });

    it("includes array notation in description for ARRAY<ROW>", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT>>");
      parsed.isFieldNullable = true;

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert.strictEqual(item.description, "ROW[]");
    });

    it("sets contextValue from getter for node without field name", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      assert.strictEqual(item.contextValue, "ccloud-flink-type-node");
    });

    it("sets contextValue from getter for node with field name", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "user_id";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.user_id",
      });
      const item = node.getTreeItem();

      assert.strictEqual(item.contextValue, "ccloud-flink-type-field");
    });

    it("sets icon for ROW type", () => {
      const parsed = parseFlinkType("ROW<id INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();

      // Icon should be a ThemeIcon with "symbol-struct"
      assert(item.iconPath);
    });

    it("includes tooltip with field information", () => {
      const column = createTestColumn("INT");
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "my_field";
      parsed.comment = "Test field";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });
      const item = node.getTreeItem();

      assert(item.tooltip);
      // Tooltip should exist and be a CustomMarkdownString
      // We just verify it exists without checking specific content
      assert(typeof item.tooltip === "object");
    });
  });

  describe("getTooltip()", () => {
    it("uses field name as header when present", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "user_id";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("user_id"));
    });

    it("uses 'Type' as header when no field name", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Type"));
    });

    it("shows full data type string in Data Type field", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR>");
      parsed.fieldName = "record";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Data Type"));
      assert(tooltipText.includes("ROW<id INT, name VARCHAR>"));
    });

    it("shows nullable status", () => {
      const parsed = parseFlinkType("INT NOT NULL");
      parsed.fieldName = "id";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Nullable"));
      assert(tooltipText.includes("No"));
    });

    it("shows comment when present", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "status";
      parsed.comment = "User status code";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Comment"));
      assert(tooltipText.includes("User status code"));
    });

    it("shows full data type for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR, age INT>");

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Data Type"));
      assert(tooltipText.includes("ROW<id INT, name VARCHAR, age INT>"));
    });

    it("shows full data type for MAP types", () => {
      const parsed = parseFlinkType("MAP<STRING, INT>");

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Data Type"));
      assert(tooltipText.includes("MAP<STRING, INT>"));
    });

    it("shows full data type for ARRAY types", () => {
      const parsed = parseFlinkType("ARRAY<INT>");

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Data Type"));
      assert(tooltipText.includes("ARRAY<INT>"));
    });

    it("handles complex nested ROW with comment and nullability", () => {
      const parsed = parseFlinkType("ROW<artist ROW<id INT, name VARCHAR>, uri VARCHAR NOT NULL>");
      parsed.fieldName = "track";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const item = node.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("track")); // header
      assert(tooltipText.includes("Data Type"));
      assert(tooltipText.includes("ROW<artist ROW<id INT, name VARCHAR>, uri VARCHAR NOT NULL>"));
      assert(tooltipText.includes("Nullable"));
      assert(!tooltipText.includes("Comment")); // no comment provided, so Comment field should not appear
    });
  });

  describe("searchableText()", () => {
    it("includes field name in searchable text", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "user_id";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const text = node.searchableText();

      assert(text.includes("user_id"));
    });

    it("includes data type in searchable text", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const text = node.searchableText();

      assert(text.includes("VARCHAR"));
    });

    it("includes NOT NULL for non-nullable types", () => {
      const parsed = parseFlinkType("INT");
      parsed.isFieldNullable = false;

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const text = node.searchableText();

      assert(text.includes("NOT NULL"));
    });

    it("includes comment if present", () => {
      const parsed = parseFlinkType("VARCHAR");
      parsed.comment = "User email address";

      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const text = node.searchableText();

      assert(text.includes("User email address"));
    });

    it("includes data type for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const text = node.searchableText();

      assert(text.includes("ROW"));
    });

    it("includes data type for compound ROW types with multiple fields", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR, email VARCHAR>");
      parsed.fieldName = "user_profile";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });
      const text = node.searchableText();

      assert(text.includes("user_profile"));
      assert(text.includes("ROW"));
    });
  });

  describe("complex nested scenarios", () => {
    it("handles deeply nested ROW structures", () => {
      const parsed = parseFlinkType("ROW<outer ROW<middle ROW<inner INT>>>");
      const column = createTestColumn("ROW<outer ROW<middle ROW<inner INT>>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      assert.strictEqual(node.isExpandable, true);

      const children1 = node.getChildren();
      assert.strictEqual(children1.length, 1);
      assert.strictEqual(children1[0].isExpandable, true);

      const children2 = children1[0].getChildren();
      assert.strictEqual(children2.length, 1);
      assert.strictEqual(children2[0].isExpandable, true);

      const children3 = children2[0].getChildren();
      assert.strictEqual(children3.length, 1);
      assert.strictEqual(children3[0].isExpandable, false);
    });

    it("handles ARRAY<ROW> with nested expansion", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT, nested ROW<inner VARCHAR>>>");
      const column = createTestColumn("ARRAY<ROW<id INT, nested ROW<inner VARCHAR>>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      assert.strictEqual(node.isExpandable, true);

      // ARRAY<ROW> returns ROW's fields directly (no intermediate node)
      const children1 = node.getChildren();
      assert.strictEqual(children1.length, 2); // id and nested fields
      assert.strictEqual(children1[0].parsedType.fieldName, "id");
      assert.strictEqual(children1[0].isExpandable, false); // id is INT
      assert.strictEqual(children1[1].parsedType.fieldName, "nested");
      assert.strictEqual(children1[1].isExpandable, true); // nested is ROW

      // Can expand the nested ROW field
      const children2 = children1[1].getChildren();
      assert.strictEqual(children2.length, 1); // inner field
      assert.strictEqual(children2[0].parsedType.fieldName, "inner");
    });

    it("handles MAP with ROW values", () => {
      const parsed = parseFlinkType("MAP<VARCHAR, ROW<value INT>>");
      const column = createTestColumn("MAP<VARCHAR, ROW<value INT>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      const children = node.getChildren();
      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].isExpandable, false); // key is scalar
      assert.strictEqual(children[1].isExpandable, true); // value is ROW
    });
  });

  describe("edge cases", () => {
    it("handles types with comments", () => {
      const parsed = parseFlinkType("ROW<id INT 'User ID'>");
      const column = createTestColumn("ROW<id INT 'User ID'>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      const children = node.getChildren();
      assert.strictEqual(children[0].parsedType.comment, "User ID");
    });

    it("ROW field with comment displays Comment in tooltip", () => {
      const parsed = parseFlinkType("ROW<id INT 'User ID'>");
      const column = createTestColumn("ROW<id INT 'User ID'>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: column.id,
      });

      const children = node.getChildren();
      const fieldNode = children[0]; // the "id INT 'User ID'" field
      const item = fieldNode.getTreeItem();
      const tooltipText = (item.tooltip as CustomMarkdownString).value;

      assert(tooltipText.includes("Comment"));
      assert(tooltipText.includes("User ID"));
    });

    it("handles types with explicit NULL keyword", () => {
      const parsed = parseFlinkType("INT NULL");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, false);
      const item = node.getTreeItem();
      assert(typeof item.description === "string");
      assert(!item.description.includes("NOT NULL"));
    });

    it("handles ARRAY<ARRAY<>> correctly", () => {
      const parsed = parseFlinkType("ARRAY<ARRAY<ROW<id INT>>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test-table.test-col",
      });

      assert.strictEqual(node.isExpandable, true);

      // ARRAY<ARRAY<ROW<>>> - outer array's element is inner ARRAY (compound)
      // Outer array creates intermediate node for inner ARRAY with [array] ID segment
      const children1 = node.getChildren();
      assert.strictEqual(children1.length, 1);
      assert.strictEqual(children1[0].parsedType.kind, FlinkTypeKind.ARRAY);
      assert.strictEqual(children1[0].id, "test-table.test-col.[array]");
      assert.strictEqual(children1[0].isExpandable, true);

      // When we expand the inner ARRAY, it skips the ROW but includes [array] in field IDs
      // (field is inside TWO arrays, so ID has TWO [array] segments)
      const children2 = children1[0].getChildren();
      assert.strictEqual(children2.length, 1);
      assert.strictEqual(children2[0].parsedType.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(children2[0].parsedType.fieldName, "id");
      assert.strictEqual(children2[0].id, "test-table.test-col.[array].[array].id");
    });

    it("generates unique IDs across complex table structure with multiple array columns", () => {
      // Simulate a complex table with multiple array columns containing the same structure
      const col1 = createTestColumn("ARRAY<ROW<id INT, name VARCHAR>>", "artists");
      const col2 = createTestColumn("ARRAY<ROW<id INT, name VARCHAR>>", "metadata");

      // Get type children from the columns (which creates synthetic parent nodes)
      // This is the real-world usage pattern
      const col1Children = col1.getChildren();
      const col2Children = col2.getChildren();

      assert.strictEqual(col1Children.length, 2);
      assert.strictEqual(col2Children.length, 2);

      // Collect all IDs from both columns
      const allIds = [...col1Children.map((c) => c.id), ...col2Children.map((c) => c.id)];

      // Check that all IDs are unique
      const uniqueIds = new Set(allIds);
      assert.strictEqual(
        allIds.length,
        uniqueIds.size,
        `Found duplicate IDs: ${allIds.filter((id, i) => allIds.indexOf(id) !== i).join(", ")}`,
      );

      // Verify the IDs have the correct structure: table.columnName.[array].fieldName
      assert.strictEqual(col1Children[0].id, "test_table.artists.[array].id");
      assert.strictEqual(col1Children[1].id, "test_table.artists.[array].name");

      assert.strictEqual(col2Children[0].id, "test_table.metadata.[array].id");
      assert.strictEqual(col2Children[1].id, "test_table.metadata.[array].name");

      // Verify column1's ids are different from column2's despite same field names
      assert.notStrictEqual(
        col1Children[0].id,
        col2Children[0].id,
        "Different columns should have different IDs even with same field names",
      );
    });

    it("handles deeply nested ARRAY<ARRAY<MULTISET<ROW>>> with proper ID generation", () => {
      // Complex deeply nested type: ARRAY<ARRAY<MULTISET<ROW<id INT>>>>
      // This tests multiple levels of container nesting with different container types
      const parsed = parseFlinkType("ARRAY<ARRAY<MULTISET<ROW<id INT>>>>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.complex_field",
      });

      assert.strictEqual(node.isExpandable, true);
      assert.strictEqual(node.parsedType.kind, FlinkTypeKind.ARRAY);

      // Level 1: Expand outer ARRAY -> get intermediate [array] node for inner ARRAY
      const level1 = node.getChildren();
      assert.strictEqual(level1.length, 1, "Outer ARRAY should have one child (inner ARRAY)");
      assert.strictEqual(level1[0].parsedType.kind, FlinkTypeKind.ARRAY);
      assert.strictEqual(level1[0].id, "test_table.complex_field.[array]");
      assert.strictEqual(level1[0].isExpandable, true);

      // Level 2: Expand inner ARRAY -> get intermediate [array] node for nested ARRAY level
      const level2 = level1[0].getChildren();
      assert.strictEqual(level2.length, 1, "Inner ARRAY should have one child (MULTISET)");
      assert.strictEqual(level2[0].parsedType.kind, FlinkTypeKind.MULTISET);
      assert.strictEqual(level2[0].id, "test_table.complex_field.[array].[array]");
      assert.strictEqual(level2[0].isExpandable, true);

      // Level 3: Expand MULTISET -> get ROW fields directly (skip ROW node but include [multiset] in IDs)
      // Field is inside ARRAY -> ARRAY -> MULTISET, so ID has [array].[array].[multiset]
      const level3 = level2[0].getChildren();
      assert.strictEqual(level3.length, 1, "MULTISET should have one child (id field from ROW)");
      assert.strictEqual(level3[0].parsedType.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(level3[0].parsedType.fieldName, "id");
      assert.strictEqual(level3[0].id, "test_table.complex_field.[array].[array].[multiset].id");
      assert.strictEqual(level3[0].isExpandable, false);

      // Verify all IDs are unique in the hierarchy
      const allIds = [node.id, level1[0].id, level2[0].id, level3[0].id];
      const uniqueIds = new Set(allIds);
      assert.strictEqual(
        allIds.length,
        uniqueIds.size,
        `Found duplicate IDs in hierarchy: ${allIds}`,
      );
    });
  });

  describe("name getter", () => {
    it("returns field name when present", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "user_id";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.user_id",
      });

      assert.strictEqual(node.name, "user_id");
    });

    it("returns undefined when field name is not present", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.column",
      });

      assert.strictEqual(node.name, undefined);
    });
  });

  describe("nestedPath getter", () => {
    it("returns simple column name for top-level column node", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "users.data",
      });

      assert.strictEqual(node.nestedPath, "data");
    });

    it("returns nested field path for ROW field", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      parsed.fieldName = "street";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "users.address.street",
      });

      assert.strictEqual(node.nestedPath, "address.street");
    });

    it("returns deeply nested path for multi-level ROW fields", () => {
      const parsed = parseFlinkType("VARCHAR");
      parsed.fieldName = "city";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "users.address.location.city",
      });

      assert.strictEqual(node.nestedPath, "address.location.city");
    });

    it("returns undefined if path contains [array] synthetic segment", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "field";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "users.data.[array].field",
      });

      assert.strictEqual(node.nestedPath, undefined);
    });

    it("returns undefined if path contains [multiset] synthetic segment", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "field";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "users.data.[multiset].field",
      });

      assert.strictEqual(node.nestedPath, undefined);
    });

    it("returns undefined if path contains multiple synthetic segments", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "field";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "users.data.[array].[multiset].field",
      });

      assert.strictEqual(node.nestedPath, undefined);
    });

    it("returns undefined for synthetic array node itself", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "users.data.[array]",
      });

      assert.strictEqual(node.nestedPath, undefined);
    });
  });

  describe("isWithinSyntheticElement", () => {
    it("returns false for top-level column nodes", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.column",
      });

      assert.strictEqual(node["isWithinSyntheticElement"](), false);
    });

    it("returns false for ROW field nodes", () => {
      const parsed = parseFlinkType("VARCHAR");
      parsed.fieldName = "street";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.address.street",
      });

      assert.strictEqual(node["isWithinSyntheticElement"](), false);
    });

    it("returns true for nodes with [array] synthetic segment", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "id";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.data.[array].id",
      });

      assert.strictEqual(node["isWithinSyntheticElement"](), true);
    });

    it("returns true for nodes with [multiset] synthetic segment", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.data.[multiset].field",
      });

      assert.strictEqual(node["isWithinSyntheticElement"](), true);
    });

    it("returns true for synthetic array node itself", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.data.[array]",
      });

      assert.strictEqual(node["isWithinSyntheticElement"](), true);
    });
  });

  describe("contextValue getter", () => {
    it("returns 'ccloud-flink-type-node' for top-level column nodes without field name", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.column",
      });

      assert.strictEqual(node.contextValue, "ccloud-flink-type-node");
    });

    it("returns 'ccloud-flink-type-field' for ROW field nodes with field names (not synthetic)", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "user_id";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.user_id",
      });

      assert.strictEqual(node.contextValue, "ccloud-flink-type-field");
    });

    it("returns 'ccloud-flink-type-field-synthetic' for field nodes within [array] synthetic elements", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "interior_int";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.data.[array].[array].interior_int",
      });

      assert.strictEqual(node.contextValue, "ccloud-flink-type-field-synthetic");
    });

    it("returns 'ccloud-flink-type-node-synthetic' for synthetic array nodes without field name", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.data.[array]",
      });

      assert.strictEqual(node.contextValue, "ccloud-flink-type-node-synthetic");
    });

    it("returns 'ccloud-flink-type-field' for deeply nested ROW field (no synthetic ancestry)", () => {
      const parsed = parseFlinkType("VARCHAR");
      parsed.fieldName = "city";
      const node = new FlinkTypeNode({
        parsedType: parsed,
        id: "test_table.address.location.city",
      });

      assert.strictEqual(node.contextValue, "ccloud-flink-type-field");
    });

    it("returns 'ccloud-flink-type-field-synthetic' for fields within ARRAY<ROW>", () => {
      const column = new FlinkRelationColumn({
        ...createTestColumn("ARRAY<ROW<id INT>>"),
        name: "artists",
        fullDataType: "ARRAY<ROW<id INT>>",
      });

      const children = column.getChildren();
      assert.strictEqual(children.length, 1);
      assert.strictEqual(children[0].parsedType.fieldName, "id");
      assert.strictEqual(children[0].contextValue, "ccloud-flink-type-field-synthetic");
    });

    it("returns 'ccloud-flink-type-field-synthetic' for fields within MULTISET<ROW>", () => {
      const column = new FlinkRelationColumn({
        ...createTestColumn("MULTISET<ROW<status VARCHAR>>"),
        name: "events",
        fullDataType: "MULTISET<ROW<status VARCHAR>>",
      });

      const children = column.getChildren();
      assert.strictEqual(children.length, 1);
      assert.strictEqual(children[0].parsedType.fieldName, "status");
      assert.strictEqual(children[0].contextValue, "ccloud-flink-type-field-synthetic");
    });

    it("returns undefined nestedPath for fields within ARRAY<ROW>", () => {
      const column = new FlinkRelationColumn({
        ...createTestColumn("ARRAY<ROW<id INT>>"),
        name: "artists",
        fullDataType: "ARRAY<ROW<id INT>>",
      });

      const children = column.getChildren();
      assert.strictEqual(children[0].nestedPath, undefined);
    });

    it("returns undefined nestedPath for fields within MULTISET<ROW>", () => {
      const column = new FlinkRelationColumn({
        ...createTestColumn("MULTISET<ROW<field VARCHAR>>"),
        name: "items",
        fullDataType: "MULTISET<ROW<field VARCHAR>>",
      });

      const children = column.getChildren();
      assert.strictEqual(children[0].nestedPath, undefined);
    });
  });
});
