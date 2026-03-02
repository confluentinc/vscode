import assert from "assert";
import { describe, it } from "mocha";
import {
  TEST_FLINK_RELATION,
  TEST_VARCHAR_COLUMN,
} from "../../tests/unit/testResources/flinkRelation";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { IconNames } from "../icons";
import {
  FlinkRelation,
  FlinkRelationColumn,
  FlinkRelationType,
  toRelationType,
} from "./flinkRelation";

describe("flinkRelation.ts", () => {
  describe("FlinkRelationType.toRelationType", () => {
    it("should convert valid strings to FlinkRelationType enum", () => {
      assert.strictEqual(toRelationType("BASE TABLE"), FlinkRelationType.BaseTable);
      assert.strictEqual(toRelationType("VIEW"), FlinkRelationType.View);
      assert.strictEqual(toRelationType("SYSTEM TABLE"), FlinkRelationType.SystemTable);
      assert.strictEqual(toRelationType("EXTERNAL TABLE"), FlinkRelationType.ExternalTable);
    });
    it("should throw an error for unknown relation types", () => {
      assert.throws(() => toRelationType("UNKNOWN"), /Unknown relation type: UNKNOWN/);
    });
  });

  describe("FlinkRelationColumn", () => {
    describe("properties", () => {
      it("id", () => {
        assert.deepEqual(
          TEST_VARCHAR_COLUMN.id,
          `${TEST_VARCHAR_COLUMN.relationName}.${TEST_VARCHAR_COLUMN.name}`,
        );
      });

      it("connectionId", () => {
        assert.strictEqual(TEST_VARCHAR_COLUMN.connectionId, CCLOUD_CONNECTION_ID);
      });

      it("connectionType", () => {
        assert.strictEqual(TEST_VARCHAR_COLUMN.connectionType, ConnectionType.Ccloud);
      });

      it("isMetaColumn", () => {
        const metaColumn = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          metadataKey: "topicMetadata",
        });
        assert.strictEqual(metaColumn.isMetadata, true);
        assert.strictEqual(TEST_VARCHAR_COLUMN.isMetadata, false);
      });

      describe("treeItemDescription", () => {
        it("no comment, nullable", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            isNullable: true,
            fullDataType: "INT",
            comment: null,
          });
          assert.strictEqual(column.treeItemDescription, "INT");
        });
        it("with short comment", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            isNullable: false,
            fullDataType: "VARCHAR(2147483647)",
            comment: "This is a test column",
          });
          assert.strictEqual(
            column.treeItemDescription,
            "VARCHAR NOT NULL - This is a test column",
          );
        });

        it("with long comment + nullable", () => {
          const longComment = "This is a very long comment ".repeat(10).trim();
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            isNullable: true,
            fullDataType: "INT",
            comment: longComment,
          });
          // At this time, James is choosing to no
          assert.strictEqual(
            column.treeItemDescription,
            `INT - ${longComment.substring(0, 30)}...`,
          );
        });
      });

      describe("simpleDataType", () => {
        it("should simplify max varchar types", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            fullDataType: "VARCHAR(2147483647)",
          });
          const simpleType = column.simpleDataType;
          assert.strictEqual(simpleType, "VARCHAR");
        });

        it("should simplify ROW types", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            fullDataType: "ROW<`field1` INT, `field2` VARCHAR(2147483647)>",
          });
          const simpleType = column.simpleDataType;
          assert.strictEqual(simpleType, "ROW");
        });

        it("should simplify MAP types", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            fullDataType: "MAP<STRING, VARCHAR(2147483647)>",
          });
          const simpleType = column.simpleDataType;
          assert.strictEqual(simpleType, "MAP");
        });

        it("should simplify ARRAY types with element type", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            fullDataType: "ARRAY<INT>",
          });
          const simpleType = column.simpleDataType;
          assert.strictEqual(simpleType, "INT[]");
        });

        it("should simplify MULTISET types with element type", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            fullDataType: "MULTISET<STRING>",
          });
          const simpleType = column.simpleDataType;
          assert.strictEqual(simpleType, "STRING MULTISET");
        });

        for (const type of ["INT", "VARCHAR(100)", "BOOLEAN", "TIMESTAMP(3)"]) {
          it(`should return base type for simple type: ${type}`, () => {
            const column = new FlinkRelationColumn({
              ...TEST_VARCHAR_COLUMN,
              fullDataType: type,
            });
            const simpleType = column.simpleDataType;
            assert.strictEqual(simpleType, type);
          });
        }
      });
    });

    describe("searchableText()", () => {
      it("should return a concatenated string of searchable fields", () => {
        const column = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          name: "searchableColumn",
          fullDataType: "VARCHAR(2147483647)",
          metadataKey: "some_key",
          comment: "This is a searchable column",
        });
        const searchText = column.searchableText();

        assert.ok(searchText.includes("searchableColumn"));
        assert.ok(searchText.includes("VARCHAR"));
        assert.ok(searchText.includes("some_key"));
        assert.ok(searchText.includes("This is a searchable column"));
      });
    });

    describe("getTreeItem()", () => {
      it("should return a tree item with correct properties", () => {
        const column = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          name: "testColumn",
          fullDataType: "VARCHAR(2147483647)",
          isNullable: false,
          comment: "Test column comment",
        });
        const treeItem = column.getTreeItem();
        assert.strictEqual(treeItem.label, column.name);
        assert.strictEqual(treeItem.description, column.treeItemDescription);
        assert.strictEqual(treeItem.contextValue, "ccloud-flink-column");
        assert.deepStrictEqual(treeItem.tooltip, column.getToolTip());
      });
    });

    describe("getToolTip()", () => {
      it("should format tooltip with all column details", () => {
        const column = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          name: "tooltipColumn",
          fullDataType: "VARCHAR(2147483647)",
          isNullable: false,
          comment: "Tooltip column comment",
          metadataKey: "metadata_key",
          distributionKeyNumber: 1,
          isGenerated: true,
        });
        const tooltip = column.getToolTip();

        const patterns: RegExp[] = [
          /Flink Column/,
          /Name: `tooltipColumn`/,
          /Data Type: `VARCHAR`/,
          /Nullable: `No`/,
          /Persisted: `Yes`/,
          /Distribution Key Number: `1`/,
          /Generated: `Yes`/,
          /Metadata Column: `Yes, maps to key: metadata_key`/,
          /Comment: `Tooltip column comment`/,
        ];

        for (const pattern of patterns) {
          assert.match(tooltip.value, pattern);
        }
      });

      it("does not mention optional columns when not applicable", () => {
        const column = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          name: "tooltipColumn",
          fullDataType: "INT",
          isNullable: true,
          isGenerated: false,
          isPersisted: false,
          comment: null,
        });
        const tooltip = column.getToolTip();

        const absentPatterns: RegExp[] = [
          /Distribution Key Number:/,
          /Metadata Column:/,
          /Comment:/,
        ];

        for (const pattern of absentPatterns) {
          assert.doesNotMatch(tooltip.value, pattern);
        }
      });
    });

    describe("getTypeChildren()", () => {
      // Helper to verify isExpandable consistency: children exist iff isExpandable is true
      function assertExpandableConsistency(column: FlinkRelationColumn, expectedLength: number) {
        const isExpandable = column.isExpandable;
        const children = column.getTypeChildren();
        const hasChildren = children.length > 0;

        if (expectedLength === 0) {
          assert.strictEqual(
            isExpandable,
            false,
            "Should NOT be expandable when no children exist",
          );
          assert.strictEqual(hasChildren, false, "Should have no children when not expandable");
        } else {
          assert.strictEqual(
            isExpandable,
            true,
            `Should be expandable when ${expectedLength} children exist`,
          );
          assert.strictEqual(
            hasChildren,
            true,
            `Should have children when expandable (expected ${expectedLength})`,
          );
        }

        assert.strictEqual(
          children.length,
          expectedLength,
          `Expected ${expectedLength} children, got ${children.length}`,
        );
      }

      describe("scalar types (non-expandable)", () => {
        it("returns empty array for INT column", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "score",
            fullDataType: "INT",
          });

          assertExpandableConsistency(column, 0);
        });

        it("returns empty array for VARCHAR column", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "name",
            fullDataType: "VARCHAR",
          });

          assertExpandableConsistency(column, 0);
        });

        it("returns empty array for DECIMAL(10,2) column", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "amount",
            fullDataType: "DECIMAL(10,2)",
          });

          assertExpandableConsistency(column, 0);
        });
      });

      describe("ROW types (expandable)", () => {
        it("returns field children for simple ROW<id INT, name VARCHAR>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "person",
            fullDataType: "ROW<id INT, name VARCHAR>",
          });

          assertExpandableConsistency(column, 2);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.fieldName, "id");
          assert.strictEqual(children[1].parsedType.fieldName, "name");
        });

        it("returns field children for ROW with many fields", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "metadata",
            fullDataType: "ROW<id INT, name VARCHAR, age INT, active BOOLEAN>",
          });

          assertExpandableConsistency(column, 4);
          const children = column.getTypeChildren();
          assert.strictEqual(
            children.map((c) => c.parsedType.fieldName).join(","),
            "id,name,age,active",
          );
        });

        it("returns field children for ROW with nested ROW", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "address",
            fullDataType:
              "ROW<street VARCHAR, city VARCHAR, location ROW<lat DECIMAL, lng DECIMAL>>",
          });

          assertExpandableConsistency(column, 3);
          const children = column.getTypeChildren();
          assert.strictEqual(
            children.map((c) => c.parsedType.fieldName).join(","),
            "street,city,location",
          );
        });
      });

      describe("MAP types (expandable)", () => {
        it("returns key and value children for MAP<VARCHAR, INT>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "scores",
            fullDataType: "MAP<VARCHAR, INT>",
          });

          assertExpandableConsistency(column, 2);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.fieldName, "key");
          assert.strictEqual(children[1].parsedType.fieldName, "value");
        });

        it("returns key and value children for MAP<INT, VARCHAR>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "mapping",
            fullDataType: "MAP<INT, VARCHAR>",
          });

          assertExpandableConsistency(column, 2);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.fieldName, "key");
          assert.strictEqual(children[1].parsedType.fieldName, "value");
        });
      });

      describe("ARRAY with scalar elements (non-expandable)", () => {
        it("returns empty array for ARRAY<INT>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "scores",
            fullDataType: "ARRAY<INT>",
          });

          assertExpandableConsistency(column, 0);
        });

        it("returns empty array for ARRAY<VARCHAR>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "tags",
            fullDataType: "ARRAY<VARCHAR>",
          });

          assertExpandableConsistency(column, 0);
        });

        it("returns empty array for ARRAY<DECIMAL(10,2)>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "amounts",
            fullDataType: "ARRAY<DECIMAL(10,2)>",
          });

          assertExpandableConsistency(column, 0);
        });
      });

      describe("ARRAY with compound elements (expandable)", () => {
        it("returns ROW field children for ARRAY<ROW<id INT, name VARCHAR>>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "people",
            fullDataType: "ARRAY<ROW<id INT, name VARCHAR>>",
          });

          assertExpandableConsistency(column, 2);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.fieldName, "id");
          assert.strictEqual(children[1].parsedType.fieldName, "name");
        });

        it("returns MAP key/value children for ARRAY<MAP<VARCHAR, INT>>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "score_lists",
            fullDataType: "ARRAY<MAP<VARCHAR, INT>>",
          });

          assertExpandableConsistency(column, 2);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.fieldName, "key");
          assert.strictEqual(children[1].parsedType.fieldName, "value");
        });

        it("returns element children for ARRAY<ARRAY<ROW<id INT>>>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "nested_people",
            fullDataType: "ARRAY<ARRAY<ROW<id INT>>>",
          });

          // ARRAY<ARRAY<ROW>> is expandable (outer ARRAY has compound element ARRAY<ROW>)
          // Returns the ROW field from the inner ARRAY, skipping the intermediate container
          assertExpandableConsistency(column, 1);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.kind, "ROW");
          assert.strictEqual(children[0].parsedType.dataType, "ROW");
          assert.strictEqual(children[0].parsedType.members.length, 1);
          assert.strictEqual(children[0].parsedType.members[0].fieldName, "id");
        });

        it("generates globally unique IDs across multiple ARRAY<ROW> columns with same field names", () => {
          // This test proves that even though two different columns have identical
          // ROW structures with the same field names, their child nodes have globally
          // unique IDs within the tree view.
          // This is critical for handling the synthetic parent node pattern where
          // FlinkRelationColumn.getTypeChildren() creates a non-displayed ARRAY/MULTISET
          // node to maintain proper ID hierarchy.

          const column1 = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "users_table",
            name: "metadata",
            fullDataType: "ARRAY<ROW<id INT, name VARCHAR>>",
          });

          const column2 = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "orders_table",
            name: "metadata",
            fullDataType: "ARRAY<ROW<id INT, name VARCHAR>>",
          });

          // Verify both are expandable
          assert.strictEqual(column1.isExpandable, true, "column1 should be expandable");
          assert.strictEqual(column2.isExpandable, true, "column2 should be expandable");

          // Get children from both columns
          const children1 = column1.getTypeChildren();
          const children2 = column2.getTypeChildren();

          // Both should have 2 children (the ROW's two fields)
          assert.strictEqual(children1.length, 2, "Column 1 should have 2 field children");
          assert.strictEqual(children2.length, 2, "Column 2 should have 2 field children");

          // Collect all IDs
          const allIds = [
            ...children1.map((child) => child.id),
            ...children2.map((child) => child.id),
          ];

          // Verify all IDs are unique (no duplicates)
          const uniqueIds = new Set(allIds);
          assert.strictEqual(
            allIds.length,
            uniqueIds.size,
            "All IDs should be globally unique across columns",
          );

          // Verify IDs include column context despite same field names
          const ids1 = new Set(children1.map((child) => child.id));
          const ids2 = new Set(children2.map((child) => child.id));

          // The sets should be completely disjoint (no overlap)
          const intersection = new Set([...ids1].filter((id) => ids2.has(id)));
          assert.strictEqual(
            intersection.size,
            0,
            "IDs from different columns should be completely different due to column ID prefix",
          );

          // Verify IDs have expected structure: relationName.columnName.fieldName
          for (const id of ids1) {
            assert.match(
              id,
              /^users_table\.metadata\.(id|name)$/,
              `Column 1 ID should be: users_table.metadata.(id|name): ${id}`,
            );
          }

          for (const id of ids2) {
            assert.match(
              id,
              /^orders_table\.metadata\.(id|name)$/,
              `Column 2 ID should be: orders_table.metadata.(id|name): ${id}`,
            );
          }
        });
      });

      describe("MULTISET with scalar elements (non-expandable)", () => {
        it("returns empty array for MULTISET<INT>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "numbers",
            fullDataType: "MULTISET<INT>",
          });

          assertExpandableConsistency(column, 0);
        });

        it("returns empty array for MULTISET<VARCHAR>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "tags",
            fullDataType: "MULTISET<VARCHAR>",
          });

          assertExpandableConsistency(column, 0);
        });
      });

      describe("MULTISET with compound elements (expandable)", () => {
        it("returns ROW field children for MULTISET<ROW<id INT, value VARCHAR>>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "items",
            fullDataType: "MULTISET<ROW<id INT, value VARCHAR>>",
          });

          assertExpandableConsistency(column, 2);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.fieldName, "id");
          assert.strictEqual(children[1].parsedType.fieldName, "value");
        });

        it("returns MAP key/value children for MULTISET<MAP<VARCHAR, INT>>", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "data_sets",
            fullDataType: "MULTISET<MAP<VARCHAR, INT>>",
          });

          assertExpandableConsistency(column, 2);
          const children = column.getTypeChildren();
          assert.strictEqual(children[0].parsedType.fieldName, "key");
          assert.strictEqual(children[1].parsedType.fieldName, "value");
        });

        it("generates unique IDs for MULTISET<ROW> columns", () => {
          const column = new FlinkRelationColumn({
            ...TEST_VARCHAR_COLUMN,
            relationName: "test_table",
            name: "items",
            fullDataType: "MULTISET<ROW<id INT, value VARCHAR>>",
          });

          // Verify expandable
          assert.strictEqual(column.isExpandable, true, "Should be expandable");

          const children = column.getTypeChildren();

          assert.strictEqual(children.length, 2, "Should have 2 field children from MULTISET<ROW>");

          // Verify IDs use field names
          const ids = children.map((child) => child.id);
          for (const id of ids) {
            assert.match(
              id,
              /^test_table\.items\.(id|value)$/,
              `MULTISET ID should be: test_table.items.(id|value): ${id}`,
            );
          }

          // All IDs should be unique
          const uniqueIds = new Set(ids);
          assert.strictEqual(ids.length, uniqueIds.size, "All IDs should be unique");
        });
      });
    });

    describe("getParsedType()", () => {
      it("returns synthetic SCALAR type and logs error for unparseable type strings", () => {
        const column = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          relationName: "test_table",
          name: "bad_column",
          // Empty type that will cause parser to throw
          fullDataType: "",
        });

        // Call getParsedType - should return synthetic SCALAR type for unparseable input
        const result = column.getParsedType();
        assert.ok(result, "Should return a FlinkType (not null)");
        assert.strictEqual(result.kind, "SCALAR", "Should return synthetic SCALAR type");
        assert.strictEqual(
          result.dataType,
          "",
          "Should preserve the unparseable input as dataType",
        );

        // Call again - should return cached result (same object reference)
        const result2 = column.getParsedType();
        assert.strictEqual(result, result2, "Should cache result on second call");
      });

      it("successfully parses valid type strings and caches result", () => {
        const column = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          relationName: "test_table",
          name: "good_column",
          fullDataType: "ARRAY<ROW<id INT, name VARCHAR>>",
        });

        // First call should parse successfully
        const result1 = column.getParsedType();
        assert.ok(result1, "Should successfully parse valid type");
        assert.strictEqual(result1.kind, "ARRAY", "Should correctly identify ARRAY type");

        // Second call should return cached result (same object reference)
        const result2 = column.getParsedType();
        assert.strictEqual(result1, result2, "Should return cached result on second call");
      });
    });

    describe("tooltipLine()", () => {
      it("should return a single line tooltip for the column", () => {
        const column = new FlinkRelationColumn({
          ...TEST_VARCHAR_COLUMN,
          name: "lineTooltipColumn",
          fullDataType: "VARCHAR(2147483647)",
          isNullable: false,
          distributionKeyNumber: 1,
          isGenerated: true,
          metadataKey: "metaKey",
        });
        const lineTooltip = column.tooltipLine();
        assert.strictEqual(
          lineTooltip,
          "lineTooltipColumn: VARCHAR NOT NULL GENERATED DISTKEY(1) METADATA('metaKey')",
        );
      });
    });
  });

  describe("FlinkRelation", () => {
    describe("properties", () => {
      it("id", () => {
        const relation = new FlinkRelation({
          ...TEST_FLINK_RELATION,
          name: "MyTable",
        });
        assert.strictEqual(relation.id, "MyTable");
      });

      it("connectionId", () => {
        assert.strictEqual(TEST_FLINK_RELATION.connectionId, CCLOUD_CONNECTION_ID);
      });

      it("connectionType", () => {
        assert.strictEqual(TEST_FLINK_RELATION.connectionType, ConnectionType.Ccloud);
      });

      it("visibleColumns", () => {
        // Test assumes all columns in TEST_FLINK_RELATION should be visible.
        assert.ok(TEST_FLINK_RELATION.visibleColumns.every((col) => !col.isHidden));

        const testRelation = new FlinkRelation({
          ...TEST_FLINK_RELATION,
          columns: [
            ...TEST_FLINK_RELATION.columns,
            new FlinkRelationColumn({
              ...TEST_VARCHAR_COLUMN,
              isHidden: true,
            }),
          ],
        });
        const visibleCols = testRelation.visibleColumns;
        // Skips the hidden column.
        assert.strictEqual(visibleCols.length, TEST_FLINK_RELATION.columns.length);
        assert.ok(visibleCols.every((col) => !col.isHidden));
      });

      const defaultIcon = IconNames.TOPIC;
      const viewIcon = IconNames.FLINK_VIEW;
      const scenarios: Array<[FlinkRelationType, IconNames]> = [
        [FlinkRelationType.BaseTable, defaultIcon],
        [FlinkRelationType.ExternalTable, defaultIcon],
        [FlinkRelationType.SystemTable, defaultIcon],
        [FlinkRelationType.View, viewIcon],
      ];
      for (const [type, expectedIcon] of scenarios) {
        it(`iconName varies by relation type: ${type}`, () => {
          const relation = new FlinkRelation({
            ...TEST_FLINK_RELATION,
            name: `relationType${type}`,
            type,
          });
          assert.strictEqual(relation.iconName, expectedIcon);
        });
      }
    });

    it("searchableText()", () => {
      const relation = new FlinkRelation({
        ...TEST_FLINK_RELATION,
        name: "searchableRelation",
        type: FlinkRelationType.View,
        comment: "This is a searchable relation",
        columns: [TEST_VARCHAR_COLUMN],
      });
      const searchText = relation.searchableText();

      assert.ok(searchText.includes("searchableRelation"));
      assert.ok(searchText.includes("VIEW"));
      assert.ok(searchText.includes("This is a searchable relation"));
      assert.ok(searchText.includes(TEST_VARCHAR_COLUMN.name));
      assert.ok(searchText.includes(TEST_VARCHAR_COLUMN.simpleDataType));
    });
  });

  it("getTreeItem()", () => {
    const relation = new FlinkRelation({
      ...TEST_FLINK_RELATION,
      name: "treeItemRelation",
      type: FlinkRelationType.BaseTable,
    });
    const treeItem = relation.getTreeItem();
    assert.strictEqual(treeItem.label, relation.name);
    assert.strictEqual(treeItem.contextValue, "ccloud-flink-relation-base-table");
    assert.deepStrictEqual(treeItem.tooltip, relation.getToolTip());
  });

  describe("getToolTip()", () => {
    // Refactored: generate one test per expected pattern
    const nonWatermarkedTablePatterns: RegExp[] = [
      /Flink Table/,
      /Name: `tooltipRelation`/,
      /Distribution Bucket Count: `4`/,
      /Comment: `Tooltip relation comment`/,
      /Watermarked: `No`/,
    ];

    for (const pattern of nonWatermarkedTablePatterns) {
      it(`Formats non-watermarked table (matches: ${pattern})`, () => {
        const relation = new FlinkRelation({
          ...TEST_FLINK_RELATION,
          name: "tooltipRelation",
          type: FlinkRelationType.BaseTable,
          comment: "Tooltip relation comment",
          distributionBucketCount: 4,
          columns: [TEST_VARCHAR_COLUMN],
        });
        const tooltip = relation.getToolTip();

        assert.match(tooltip.value, pattern);
      });
    }

    it("shows view definition for views with known definitions", () => {
      const relation = new FlinkRelation({
        ...TEST_FLINK_RELATION,
        name: "viewRelation",
        type: FlinkRelationType.View,
        columns: [TEST_VARCHAR_COLUMN],
      });

      // Hotrodded into the object after construction since the view definition information
      // isn't known at construction time (see parseRelationsAndColumnsSystemCatalogQueryResponse())
      relation.viewDefinition = "SELECT * FROM some_table";

      const tooltip = relation.getToolTip();

      assert.match(tooltip.value, /View Definition:/);
      assert.match(tooltip.value, /SELECT \* FROM some_table/);
    });

    it("Does not fail if a view has no definition", () => {
      const relation = new FlinkRelation({
        ...TEST_FLINK_RELATION,
        name: "viewRelationNoDef",
        type: FlinkRelationType.View,
        columns: [TEST_VARCHAR_COLUMN],
      });

      // No viewDefinition set

      const tooltip = relation.getToolTip();

      assert.doesNotMatch(tooltip.value, /View Definition:/);
    });

    it("Views omit watermark and distribution info", () => {
      const relation = new FlinkRelation({
        ...TEST_FLINK_RELATION,
        name: "viewRelationNoWatermarkDist",
        type: FlinkRelationType.View,
        columns: [TEST_VARCHAR_COLUMN],
      });
      const tooltip = relation.getToolTip();

      const absentPatterns: RegExp[] = [
        /Distribution:/,
        /Watermarked:/,
        /Watermark Column:/,
        /Watermark Expression:/,
      ];

      for (const pattern of absentPatterns) {
        assert.doesNotMatch(tooltip.value, pattern);
      }
    });

    it("Formats non-distributed, watermarked table", () => {
      const relation = new FlinkRelation({
        ...TEST_FLINK_RELATION,
        name: "watermarkedRelation",
        type: FlinkRelationType.BaseTable,
        isDistributed: false,
        distributionBucketCount: 0,
        isWatermarked: true,
        watermarkExpression: "WATERMARK FOR ts AS ts - INTERVAL '5' SECOND",
        watermarkColumnName: "ts",
        watermarkColumnIsHidden: true,
        columns: [TEST_VARCHAR_COLUMN],
      });
      const tooltip = relation.getToolTip();

      for (const pattern of [
        /Distribution: `Not distributed`/,
        /Watermarked: `Yes`/,
        /Watermark Column: `ts \(hidden\)`/,
        /Watermark Expression: `WATERMARK FOR ts AS ts - INTERVAL '5' SECOND`/,
      ]) {
        assert.match(tooltip.value, pattern);
      }
    });
  });
});
