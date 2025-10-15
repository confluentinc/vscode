import * as assert from "assert";
import {
  CompositeFlinkRelationColumn,
  FlinkRelationColumn,
  MapFlinkRelationColumn,
} from "../flinkSystemCatalog";
import { relationColumnFactory } from "./relation_column_parser";

const primitiveDataTypes = [
  "BOOLEAN",
  "BYTES",
  "VARBINARY",
  "VARBINARY(255)",
  "TINYINT",
  "SMALLINT",
  "INT",
  "BIGINT",
  "FLOAT",
  "DOUBLE",
  "DECIMAL",
  "DECIMAL(5)",
  "DECIMAL(10, 2)",
  "INTERVAL DAY",
  "INTERVAL DAY TO SECOND",
  "INTERVAL DAY(p1) TO MINUTE",
  "INTERVAL MINUTE",
  "NUMERIC",
  "CHAR",
  "CHAR(1)",
  "CHAR(10)",
  "VARCHAR(255)",
  "STRING",
  "TIMESTAMP(3) WITH LOCAL TIME ZONE",
  "TIMESTAMP(3) WITHOUT TIME ZONE",
];

const possibleComments = ["'this is a comment'", "'this comment has ''embedded'' quotes'", ""];

const nullabilitiyStrings = ["", "NULL", "NOT NULL"];

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
      for (const type of primitiveDataTypes) {
        for (const comment of possibleComments) {
          for (const toplevelNullability of nullabilitiyStrings) {
            it(`${type} nullability: ${toplevelNullability} comment: ${comment}`, () => {
              let text = type;

              if (toplevelNullability !== "") {
                text = `${text} ${toplevelNullability}`;
              }

              if (comment !== "") {
                text = `${text} ${comment}`;
              }

              const col = relationColumnFactory({
                ...fieldDefaults,
                name: "my_col",
                fullDataType: text,
                comment: null,
              });
              assert.ok(
                col instanceof FlinkRelationColumn &&
                  !(col instanceof CompositeFlinkRelationColumn) &&
                  !(col instanceof MapFlinkRelationColumn),
                "Is simple FlinkRelationColumn",
              );
              assert.strictEqual(col.name, "my_col", "Name");
              assert.strictEqual(col.simpleDataType, type, "Simple data type");
              assert.strictEqual(col.fullDataType, type, "Full data type");
              assert.strictEqual(
                col.isNullable,
                expectedNullability(toplevelNullability),
                "Nullable",
              );
              assert.strictEqual(col.isArray, false, "Is not an array");
              if (comment) {
                assert.strictEqual(col.comment, expectedComment(comment), "Comment");
              } else {
                assert.strictEqual(col.comment, null, "Comment null");
              }
            });

            it(`ARRAY of ${type}, comment ${comment}, array nullability ${toplevelNullability}`, () => {
              let text = `Array<${type}>`;

              if (toplevelNullability !== "") {
                text = `${text} ${toplevelNullability}`;
              }

              if (comment !== "") {
                text = `${text} ${comment}`;
              }

              const col = relationColumnFactory({
                ...fieldDefaults,
                name: "array_my_col",
                fullDataType: text,
                comment: null,
              });
              assert.ok(
                col instanceof FlinkRelationColumn &&
                  !(col instanceof MapFlinkRelationColumn) &&
                  !(col instanceof CompositeFlinkRelationColumn),
                "Is FlinkRelationColumn",
              );
              assert.strictEqual(col.isArray, true, "Is array");
              assert.strictEqual(col.name, "array_my_col", "Name");
              assert.strictEqual(col.simpleDataType, type, "Simple data type");
              assert.strictEqual(col.simpleTypeWithArray, `ARRAY<${type}>`, "Data type");
              assert.strictEqual(
                col.isNullable,
                expectedNullability(toplevelNullability),
                "Nullable",
              );
              if (comment) {
                assert.strictEqual(col.comment, expectedComment(comment), "Comment preserved");
              } else {
                assert.strictEqual(col.comment, null, "Comment null");
              }
            });
          }
        }
      }
    });

    describe("ROW types and arrays thereof", () => {
      it("Two column row of scalars, only name and datatypes presented", () => {
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row",
          fullDataType: "ROW<`f1` INT, `f2` STRING>",
          comment: null,
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
          comment: null,
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
          comment: null,
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

      for (const rowComment of possibleComments) {
        for (const fieldComment of possibleComments) {
          it(`Row with nested array field, itself nullable, comment on the field: ${fieldComment}, comment on row: ${rowComment}`, () => {
            // A row with two fields, the second of which is a nullable array which may have a comment.
            // The row itself is implicitly not null but may have a comment.
            const fullDataType = `ROW<\`f1\` INT, \`f2\` ARRAY<STRING> NULL ${fieldComment}> ${rowComment}`;
            const col = relationColumnFactory({
              ...fieldDefaults,
              name: "my_row",
              fullDataType: fullDataType,
              comment: null, // none provided from outside
            });
            assert.ok(
              col instanceof CompositeFlinkRelationColumn &&
                !(col instanceof MapFlinkRelationColumn),
              "Is CompositeFlinkRelationColumn",
            );
            assert.strictEqual(col.name, "my_row", "Name");
            assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
            assert.strictEqual(col.isArray, false, "row is array");
            assert.strictEqual(col.isNullable, false, "row is nullable");
            if (rowComment) {
              assert.strictEqual(col.comment, expectedComment(rowComment), "Row Comment");
            } else {
              assert.strictEqual(col.comment, null, "Row Comment null");
            }
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
            if (fieldComment) {
              assert.strictEqual(
                col.columns[1].comment,
                expectedComment(fieldComment),
                "Field Comment",
              );
            } else {
              assert.strictEqual(col.columns[1].comment, null, "Comment null");
            }
          });
        }
      }

      it("Array of rows", () => {
        // An array of rows, each with two fields, the second of which is nullable.
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row_array",
          fullDataType: "ARRAY<ROW<`f1` INT, `f2` STRING NULL>>",
          comment: null,
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
          comment: null,
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

function expectedComment(comment: string): string {
  // replace doubled single quotes with single quotes
  let retval = comment.replace(/''/g, "'");
  // trim single quotes off start and end
  if (retval.startsWith("'")) {
    retval = retval.substring(1);
  }
  if (retval.endsWith("'")) {
    retval = retval.substring(0, retval.length - 1);
  }
  return retval;
}

function expectedNullability(nullability: string): boolean {
  if (nullability === "NULL") {
    return true;
  } else {
    return false;
  }
}
