/**
 * Test suite for FlinkTypeNode.
 * Tests the parsed type node for display in the TreeView.
 */

import assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { FlinkTypeKind } from "./flinkTypes";
import type { FlinkType } from "./flinkTypes";
import { FlinkTypeNode } from "./flinkTypeNode";
import { FlinkRelationColumn } from "./flinkRelation";
import { parseFlinkType } from "../parsers/flinkTypeParser";

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
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.parsedType, parsed);
      assert.strictEqual(node.parentColumn, null);
      assert.strictEqual(node.parentNode, null);
      assert.strictEqual(node.depth, 0);
    });

    it("creates node with parentColumn", () => {
      const column = createTestColumn("ROW<id INT>");
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      assert.strictEqual(node.parentColumn, column);
    });

    it("creates node with parentNode and depth", () => {
      const parsed1 = parseFlinkType("INT");
      const node1 = new FlinkTypeNode({ parsedType: parsed1 });

      const parsed2 = parseFlinkType("VARCHAR");
      const node2 = new FlinkTypeNode({
        parsedType: parsed2,
        parentNode: node1,
        depth: 1,
      });

      assert.strictEqual(node2.parentNode, node1);
      assert.strictEqual(node2.depth, 1);
    });
  });

  describe("IResourceBase implementation", () => {
    it("has correct connectionId", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.connectionId, "vscode-confluent-cloud-connection");
    });

    it("has correct connectionType", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.connectionType, "CCLOUD");
    });
  });

  describe("id property", () => {
    it("generates id from parentColumn alone", () => {
      const column = createTestColumn("INT");
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      assert.strictEqual(node.id, "test_table.test_col");
    });

    it("includes fieldName in id for ROW fields", () => {
      const column = createTestColumn("ROW<id INT, name VARCHAR>");
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "id";

      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });
      assert.strictEqual(node.id, "test_table.test_col:id");
    });

    it("includes nested field names in id", () => {
      const column = createTestColumn("ROW<nested ROW<inner INT>>");
      const outerFieldParsed = parseFlinkType("ROW<inner INT>");
      outerFieldParsed.fieldName = "nested";

      const outerNode = new FlinkTypeNode({
        parsedType: outerFieldParsed,
        parentColumn: column,
      });

      const innerFieldParsed = parseFlinkType("INT");
      innerFieldParsed.fieldName = "inner";

      const innerNode = new FlinkTypeNode({
        parsedType: innerFieldParsed,
        parentNode: outerNode,
        parentColumn: column,
      });

      assert.strictEqual(innerNode.id, "test_table.test_col:nested:inner");
    });

    it("includes [element] for ARRAY", () => {
      const column = createTestColumn("ARRAY<INT>");
      const parsed = parseFlinkType("INT");

      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });
      const arrayParsed = parseFlinkType("ARRAY<INT>");
      const arrayNode = new FlinkTypeNode({ parsedType: arrayParsed, parentColumn: column });

      assert(arrayNode.id.includes("[element]"));
    });

    it("includes {element} for MULTISET", () => {
      const column = createTestColumn("MULTISET<VARCHAR>");
      const multisetParsed = parseFlinkType("MULTISET<VARCHAR>");
      const node = new FlinkTypeNode({ parsedType: multisetParsed, parentColumn: column });

      assert(node.id.includes("{element}"));
    });
  });

  describe("isExpandable property", () => {
    it("returns false for scalar types", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, false);
    });

    it("returns true for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns true for MAP types", () => {
      const parsed = parseFlinkType("MAP<VARCHAR, INT>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns false for ARRAY<scalar>", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, false);
    });

    it("returns true for ARRAY<ROW>", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT, name VARCHAR>>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns true for ARRAY<MAP>", () => {
      const parsed = parseFlinkType("ARRAY<MAP<VARCHAR, INT>>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns false for MULTISET<scalar>", () => {
      const parsed = parseFlinkType("MULTISET<VARCHAR>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, false);
    });

    it("returns true for MULTISET<ROW>", () => {
      const parsed = parseFlinkType("MULTISET<ROW<id INT>>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, true);
    });

    it("returns true for nested ARRAY<ARRAY<ROW>>", () => {
      const parsed = parseFlinkType("ARRAY<ARRAY<ROW<id INT>>>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, true);
    });
  });

  describe("getChildren()", () => {
    it("returns empty array for scalar types", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed });

      const children = node.getChildren();
      assert.strictEqual(children.length, 0);
    });

    it("returns member nodes for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR>");
      const column = createTestColumn("ROW<id INT, name VARCHAR>");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      const children = node.getChildren();
      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].parsedType.fieldName, "id");
      assert.strictEqual(children[1].parsedType.fieldName, "name");
    });

    it("children have correct parent references", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR>");
      const column = createTestColumn("ROW<id INT, name VARCHAR>");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      const children = node.getChildren();
      assert.strictEqual(children[0].parentNode, node);
      assert.strictEqual(children[0].parentColumn, column);
      assert.strictEqual(children[0].depth, 1);
    });

    it("returns ROW fields directly for ARRAY<ROW> (skips intermediate)", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT, name VARCHAR>>");
      const column = createTestColumn("ARRAY<ROW<id INT, name VARCHAR>>");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

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
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      const children = node.getChildren();
      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].parsedType.fieldName, "key");
      assert.strictEqual(children[1].parsedType.fieldName, "value");
    });

    it("returns empty array for ARRAY<scalar>", () => {
      const parsed = parseFlinkType("ARRAY<INT>");
      const column = createTestColumn("ARRAY<INT>");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      const children = node.getChildren();
      assert.strictEqual(children.length, 0);
    });
  });

  describe("getTreeItem()", () => {
    it("creates tree item with correct label for scalar field", () => {
      const column = createTestColumn("INT");
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "test_field";

      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });
      const item = node.getTreeItem();

      assert.strictEqual(item.label, "test_field");
    });

    it("creates tree item with element type in label for ARRAY<scalar>", () => {
      const parsed = parseFlinkType("ARRAY<VARCHAR(255)>");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      // formatSqlType only removes 2147483647, keeps other parameters
      assert.strictEqual(item.label, "VARCHAR(255)[]");
    });

    it("creates tree item with element type in label for ARRAY<ROW>", () => {
      const parsed = parseFlinkType("ARRAY<ROW<id INT>>");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      assert.strictEqual(item.label, "ROW[]");
    });

    it("creates tree item with element type in label for MULTISET<scalar>", () => {
      const parsed = parseFlinkType("MULTISET<INT>");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      assert.strictEqual(item.label, "INT MULTISET");
    });

    it("sets collapsibleState to None for non-expandable types", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.None);
    });

    it("sets collapsibleState to Collapsed for expandable types", () => {
      const parsed = parseFlinkType("ROW<id INT>");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      assert.strictEqual(item.collapsibleState, TreeItemCollapsibleState.Collapsed);
    });

    it("includes description with type and nullability", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      parsed.isFieldNullable = false;

      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert(item.description.includes("VARCHAR"));
      assert(item.description.includes("NOT NULL"));
    });

    it("omits NOT NULL in description for nullable types", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      parsed.isFieldNullable = true;

      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      assert(typeof item.description === "string");
      assert(!item.description.includes("NOT NULL"));
    });

    it("sets correct contextValue", () => {
      const parsed = parseFlinkType("INT");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      assert.strictEqual(item.contextValue, "ccloud-flink-type-node");
    });

    it("sets icon for ROW type", () => {
      const parsed = parseFlinkType("ROW<id INT>");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const item = node.getTreeItem();

      // Icon should be a ThemeIcon with "symbol-struct"
      assert(item.iconPath);
    });

    it("includes tooltip with field information", () => {
      const column = createTestColumn("INT");
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "my_field";
      parsed.comment = "Test field";

      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });
      const item = node.getTreeItem();

      assert(item.tooltip);
      // Tooltip should exist and be a CustomMarkdownString
      // We just verify it exists without checking specific content
      assert(typeof item.tooltip === "object");
    });
  });

  describe("searchableText()", () => {
    it("includes field name in searchable text", () => {
      const parsed = parseFlinkType("INT");
      parsed.fieldName = "user_id";

      const node = new FlinkTypeNode({ parsedType: parsed });
      const text = node.searchableText();

      assert(text.includes("user_id"));
    });

    it("includes data type in searchable text", () => {
      const parsed = parseFlinkType("VARCHAR(255)");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const text = node.searchableText();

      assert(text.includes("VARCHAR"));
    });

    it("includes NOT NULL for non-nullable types", () => {
      const parsed = parseFlinkType("INT");
      parsed.isFieldNullable = false;

      const node = new FlinkTypeNode({ parsedType: parsed });
      const text = node.searchableText();

      assert(text.includes("NOT NULL"));
    });

    it("includes comment if present", () => {
      const parsed = parseFlinkType("VARCHAR");
      parsed.comment = "User email address";

      const node = new FlinkTypeNode({ parsedType: parsed });
      const text = node.searchableText();

      assert(text.includes("User email address"));
    });

    it("includes type kind for compound types", () => {
      const parsed = parseFlinkType("ROW<id INT>");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const text = node.searchableText();

      assert(text.includes("row"));
    });

    it("includes member count for ROW types", () => {
      const parsed = parseFlinkType("ROW<id INT, name VARCHAR, email VARCHAR>");
      const node = new FlinkTypeNode({ parsedType: parsed });
      const text = node.searchableText();

      assert(text.includes("3 fields"));
    });
  });

  describe("complex nested scenarios", () => {
    it("handles deeply nested ROW structures", () => {
      const parsed = parseFlinkType("ROW<outer ROW<middle ROW<inner INT>>>");
      const column = createTestColumn("ROW<outer ROW<middle ROW<inner INT>>>");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

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
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

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
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      const children = node.getChildren();
      assert.strictEqual(children.length, 2);
      assert.strictEqual(children[0].isExpandable, false); // key is scalar
      assert.strictEqual(children[1].isExpandable, true); // value is ROW
    });

    it("preserves parent chain through nested expansion", () => {
      const parsed = parseFlinkType("ROW<nested ROW<inner INT>>");
      const column = createTestColumn("ROW<nested ROW<inner INT>>");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      const level1Children = node.getChildren();
      assert.strictEqual(level1Children[0].parentColumn, column);
      assert.strictEqual(level1Children[0].parentNode, node);
      assert.strictEqual(level1Children[0].depth, 1);

      const level2Children = level1Children[0].getChildren();
      assert.strictEqual(level2Children[0].parentColumn, column);
      assert.strictEqual(level2Children[0].parentNode, level1Children[0]);
      assert.strictEqual(level2Children[0].depth, 2);
    });
  });

  describe("edge cases", () => {
    it("handles types with comments", () => {
      const parsed = parseFlinkType("ROW<id INT COMMENT 'User ID'>");
      const column = createTestColumn("ROW<id INT COMMENT 'User ID'>");
      const node = new FlinkTypeNode({ parsedType: parsed, parentColumn: column });

      const children = node.getChildren();
      assert.strictEqual(children[0].parsedType.comment, "User ID");
    });

    it("handles types with explicit NULL keyword", () => {
      const parsed = parseFlinkType("INT NULL");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, false);
      const item = node.getTreeItem();
      assert(typeof item.description === "string");
      assert(!item.description.includes("NOT NULL"));
    });

    it("handles ARRAY<ARRAY<>> correctly", () => {
      const parsed = parseFlinkType("ARRAY<ARRAY<ROW<id INT>>>");
      const node = new FlinkTypeNode({ parsedType: parsed });

      assert.strictEqual(node.isExpandable, true);

      // ARRAY<ARRAY<ROW<>>> - outer array's element is inner ARRAY (compound)
      // Outer array returns inner array's members, which is [ROW<id INT>]
      // So children1 is the ROW<id INT> directly (skips inner ARRAY node)
      const children1 = node.getChildren();
      assert.strictEqual(children1.length, 1);
      assert.strictEqual(children1[0].parsedType.kind, FlinkTypeKind.ROW);
      assert.strictEqual(children1[0].isExpandable, true);

      // When we expand the ROW, we get its field
      const children2 = children1[0].getChildren();
      assert.strictEqual(children2.length, 1);
      assert.strictEqual(children2[0].parsedType.fieldName, "id");
    });

    it("generates unique IDs across complex table structure with multiple array columns", () => {
      // Simulate a complex table with multiple array columns containing the same structure
      const col1 = createTestColumn("ARRAY<ROW<id INT, name VARCHAR>", "artists");
      const col2 = createTestColumn("ARRAY<ROW<id INT, name VARCHAR>>", "metadata");

      // Create nodes for both columns
      const col1Type = parseFlinkType("ARRAY<ROW<id INT, name VARCHAR>>");
      const col1Node = new FlinkTypeNode({ parsedType: col1Type, parentColumn: col1 });

      const col2Type = parseFlinkType("ARRAY<ROW<id INT, name VARCHAR>>");
      const col2Node = new FlinkTypeNode({ parsedType: col2Type, parentColumn: col2 });

      // Get children (which should be the ROW's fields, skipping the ARRAY node)
      const col1Children = col1Node.getChildren();
      const col2Children = col2Node.getChildren();

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

      // Verify the IDs have the correct structure
      assert(col1Children[0].id.includes("artists"), "col1 ID should include column name");
      assert(col1Children[0].id.includes("[element]"), "col1 ID should include array marker");
      assert(col1Children[0].id.includes("id"), "col1 ID should include field name");

      assert(col2Children[0].id.includes("metadata"), "col2 ID should include column name");
      assert(col2Children[0].id.includes("[element]"), "col2 ID should include array marker");
      assert(col2Children[0].id.includes("id"), "col2 ID should include field name");

      // Verify column1's ids are different from column2's despite same field names
      assert.notStrictEqual(
        col1Children[0].id,
        col2Children[0].id,
        "Different columns should have different IDs even with same field names",
      );
    });
  });
});
