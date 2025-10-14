import * as assert from "assert";
import {
  CompositeFlinkRelationColumn,
  FlinkRelationColumn,
  MapFlinkRelationColumn,
} from "../flinkSystemCatalog";
import { relationColumnFactory } from "./relation_column_parser";

describe("relation_column_parser.ts", () => {
  const fieldDefaults = {
    relationName: "my_table",
    isNullable: false,
    distributionKeyNumber: null,
    isGenerated: false,
    isPersisted: true,
    isHidden: false,
    metadataKey: null,
  };
  describe("relationColumnFactory()", () => {
    describe("simple types and arrays thereof", () => {
      for (const type of [
        "BOOLEAN",
        "TINYINT",
        "SMALLINT",
        "INT",
        "BIGINT",
        "FLOAT",
        "DOUBLE",
        "DECIMAL(10, 2)",
        "CHAR(1)",
        "CHAR(10)",
        "VARCHAR(255)",
      ]) {
        it(type, () => {
          const col = relationColumnFactory({
            ...fieldDefaults,
            name: "my_col",
            fullDataType: type,
          });
          assert.ok(
            col instanceof FlinkRelationColumn &&
              !(col instanceof CompositeFlinkRelationColumn) &&
              !(col instanceof MapFlinkRelationColumn),
          );
          assert.strictEqual(col.name, "my_col");
          assert.strictEqual(col.simpleDataType, type);
          assert.strictEqual(col.fullDataType, type);
          assert.strictEqual(col.isNullable, false);
          assert.strictEqual(col.isArray, false);
        });

        it(`ARRAY of ${type}`, () => {
          const col = relationColumnFactory({
            ...fieldDefaults,
            name: "my_col",
            fullDataType: `ARRAY<${type}>`,
          });
          assert.ok(
            col instanceof FlinkRelationColumn &&
              !(col instanceof MapFlinkRelationColumn) &&
              !(col instanceof CompositeFlinkRelationColumn),
            "Is FlinkRelationColumn",
          );
          assert.strictEqual(col.isArray, true, "Is array");
          assert.strictEqual(col.name, "my_col", "Name");
          assert.strictEqual(col.simpleDataType, type, "Simple data type");
          assert.strictEqual(col.simpleTypeWithArray, `ARRAY<${type}>`, "Data type");
          assert.strictEqual(col.isNullable, false, "Nullable");
        });
      }
    });

    describe("ROW types and arrays thereof", () => {
      it("Two column row of scalars, only name and datatypes presented", () => {
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row",
          fullDataType: "ROW<`f1` INT, `f2` STRING>",
        });
        assert.ok(
          col instanceof CompositeFlinkRelationColumn && !(col instanceof MapFlinkRelationColumn),
          "Is CompositeFlinkRelationColumn",
        );
        assert.strictEqual(col.name, "my_row", "Name");
        assert.strictEqual(col.fullDataType, "ROW<`f1` INT, `f2` STRING>", "Full data type");
        assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
        assert.strictEqual(col.isArray, false, "Is array");
        assert.strictEqual(col.columns.length, 2, "Field count");
        assert.strictEqual(col.columns[0].name, "f1", "Field 1 name");
        assert.strictEqual(col.columns[0].simpleDataType, "INT", "Field 1 data type");
        assert.strictEqual(col.columns[0].isNullable, false, "Field 1 nullable");
        assert.strictEqual(col.columns[0].isArray, false, "Field 1 is array");
        assert.strictEqual(col.columns[1].name, "f2", "Field 2 name");
        assert.strictEqual(col.columns[1].simpleDataType, "STRING", "Field 2 data type");
        assert.strictEqual(col.columns[1].isNullable, false, "Field 2 nullable");
        assert.strictEqual(col.columns[1].isArray, false, "Field 2 is array");
      });

      it("Two column row of scalars, with field nullability presented", () => {
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row",
          fullDataType: "ROW<`f1` INT NOT NULL, `f2` STRING NULL>",
        });
        assert.ok(
          col instanceof CompositeFlinkRelationColumn && !(col instanceof MapFlinkRelationColumn),
          "Is CompositeFlinkRelationColumn",
        );
        assert.strictEqual(col.name, "my_row", "Name");
        assert.strictEqual(
          col.fullDataType,
          "ROW<`f1` INT NOT NULL, `f2` STRING NULL>",
          "Full data type",
        );
        assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
        assert.strictEqual(col.isArray, false, "Is array");
        assert.strictEqual(col.columns.length, 2, "Field count");
        assert.strictEqual(col.columns[0].name, "f1", "Field 1 name");
        assert.strictEqual(col.columns[0].simpleDataType, "INT", "Field 1 data type");
        assert.strictEqual(col.columns[0].isNullable, false, "Field 1 nullable");
        assert.strictEqual(col.columns[1].name, "f2", "Field 2 name");
        assert.strictEqual(col.columns[1].simpleDataType, "STRING", "Field 2 data type");
        assert.strictEqual(col.columns[1].isNullable, true, "Field 2 nullable");
      });

      it("Row with nested array field", () => {
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row",
          fullDataType: "ROW<`f1` INT, `f2` ARRAY<STRING>>",
        });
        assert.ok(
          col instanceof CompositeFlinkRelationColumn && !(col instanceof MapFlinkRelationColumn),
          "Is CompositeFlinkRelationColumn",
        );
        assert.strictEqual(col.name, "my_row", "Name");
        assert.strictEqual(col.fullDataType, "ROW<`f1` INT, `f2` ARRAY<STRING>>", "Full data type");
        assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
        assert.strictEqual(col.isArray, false, "Is array");
        assert.strictEqual(col.columns.length, 2, "Field count");
        assert.strictEqual(col.columns[0].name, "f1", "Field 1 name");
        assert.strictEqual(col.columns[0].simpleDataType, "INT", "Field 1 data type");
        assert.strictEqual(col.columns[0].isNullable, false, "Field 1 nullable");
        assert.strictEqual(col.columns[1].name, "f2", "Field 2 name");
        assert.strictEqual(
          col.columns[1].simpleTypeWithArray,
          "ARRAY<STRING>",
          "Field 2 data type",
        );
        assert.strictEqual(col.columns[1].isArray, true, "Field 2 is array");
        assert.strictEqual(col.columns[1].simpleDataType, "STRING", "Field 2 simple data type");
        assert.strictEqual(col.columns[1].isNullable, false, "Field 2 nullable");
      });

      it("Row with nested array field, itself nullable", () => {
        // f2 is a nullable array of (not nullable) strings.
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row",
          fullDataType: "ROW<`f1` INT, `f2` ARRAY<STRING> NULL>",
        });
        assert.ok(
          col instanceof CompositeFlinkRelationColumn && !(col instanceof MapFlinkRelationColumn),
          "Is CompositeFlinkRelationColumn",
        );
        assert.strictEqual(col.name, "my_row", "Name");
        assert.strictEqual(
          col.fullDataType,
          "ROW<`f1` INT, `f2` ARRAY<STRING> NULL>",
          "Full data type",
        );
        assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
        assert.strictEqual(col.isArray, false, "Is array");
        assert.strictEqual(col.columns.length, 2, "Field count");
        assert.strictEqual(col.columns[0].name, "f1", "Field 1 name");
        assert.strictEqual(col.columns[0].isNullable, false, "Field 1 nullable");
        assert.strictEqual(col.columns[1].name, "f2", "Field 2 name");
        assert.strictEqual(
          col.columns[1].simpleTypeWithArray,
          "ARRAY<STRING>",
          "Field 2 data type",
        );
        assert.strictEqual(col.columns[1].isArray, true, "Field 2 is array");
        assert.strictEqual(col.columns[1].simpleDataType, "STRING", "Field 2 simple data type");
        assert.strictEqual(col.columns[1].isNullable, true, "Field 2 nullable");
      });

      it("Array of rows", () => {
        // An array of rows, each with two fields, the second of which is nullable.
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row_array",
          fullDataType: "ARRAY<ROW<`f1` INT, `f2` STRING NULL>>",
        });
        assert.ok(
          col instanceof CompositeFlinkRelationColumn && !(col instanceof MapFlinkRelationColumn),
          "Is CompositeFlinkRelationColumn",
        );
        assert.strictEqual(col.name, "my_row_array", "Name");
        assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
        assert.strictEqual(col.isArray, true, "Is array");
        assert.strictEqual(col.simpleTypeWithArray, "ARRAY<ROW>", "simpleTypeWithArray");
        assert.strictEqual(col.columns.length, 2, "Field count");
        assert.strictEqual(col.columns[0].name, "f1", "Field 1 name");
        assert.strictEqual(col.columns[0].fullDataType, "INT", "Field 1 data type");
        assert.strictEqual(col.columns[0].isNullable, false, "Field 1 nullable");
        assert.strictEqual(col.columns[1].name, "f2", "Field 2 name");
        assert.strictEqual(col.columns[1].fullDataType, "STRING", "Field 2 data type");
        assert.strictEqual(col.columns[1].isNullable, true, "Field 2 nullable");
      });

      it("Array of rows, the array itself nullable", () => {
        // A nullable array of rows, each with two fields, the second of which is nullable.
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row_array",
          fullDataType: "ARRAY<ROW<`f1` INT, `f2` STRING NULL>> NULL",
        });
        assert.ok(
          col instanceof CompositeFlinkRelationColumn && !(col instanceof MapFlinkRelationColumn),
          "Is CompositeFlinkRelationColumn",
        );
        assert.strictEqual(col.name, "my_row_array", "Name");
        assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
        assert.strictEqual(col.isArray, true, "Is array");
        assert.strictEqual(col.simpleTypeWithArray, "ARRAY<ROW>", "simpleTypeWithArray");
        assert.strictEqual(col.isNullable, true, "Is nullable");
        assert.strictEqual(col.columns.length, 2, "Field count");
        assert.strictEqual(col.columns[0].name, "f1", "Field 1 name");
        assert.strictEqual(col.columns[0].fullDataType, "INT", "Field 1 data type");
        assert.strictEqual(col.columns[0].isNullable, false, "Field 1 nullable");
        assert.strictEqual(col.columns[1].name, "f2", "Field 2 name");
        assert.strictEqual(col.columns[1].fullDataType, "STRING", "Field 2 data type");
        assert.strictEqual(col.columns[1].isNullable, true, "Field 2 nullable");
      });
    });
  });
});
