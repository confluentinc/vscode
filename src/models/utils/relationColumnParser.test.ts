import * as assert from "assert";
import {
  CompositeFlinkRelationColumn,
  FlinkRelationColumn,
  MapFlinkRelationColumn,
} from "../flinkSystemCatalog";
import { relationColumnFactory } from "./relationColumnParser";

const primitiveDataTypes = [
  "BOOLEAN",
  "BYTES",
  "DECIMAL(10, 2)",
  "INTERVAL DAY",
  "INTERVAL DAY TO SECOND",
  "INTERVAL DAY(p1) TO MINUTE",
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

describe("relationColumnParser.ts", () => {
  const fieldDefaults = {
    relationName: "my_table",
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

      it("Row with nested ROW field", () => {
        const col = relationColumnFactory({
          ...fieldDefaults,
          name: "my_row",
          fullDataType:
            "ROW<`f1` INT, `f2` ROW<`sf1` STRING, `sf2` INT> NULL 'inner f2 row comment'> 'outer row comment'",
          comment: null,
        });

        assert.ok(
          col instanceof CompositeFlinkRelationColumn && !(col instanceof MapFlinkRelationColumn),
          "Is CompositeFlinkRelationColumn",
        );

        assert.strictEqual(col.columns[0].simpleDataType, "INT", "f1 type");
        assert.strictEqual(col.columns[0].isNullable, false, "f1 nullability");
        assert.strictEqual(col.columns[1].simpleDataType, "ROW", "f2 type");
        assert.strictEqual(col.columns[1].isNullable, true, "f2 nullability");
        assert.strictEqual(col.columns[1].comment, "inner f2 row comment", "f2 row comment");
        assert.strictEqual(col.comment, "outer row comment");
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

      for (const individualRowNullable of nullabilitiyStrings) {
        for (const f2Nullable of nullabilitiyStrings) {
          for (const f2Comment of possibleComments) {
            for (const rowComment of possibleComments) {
              it(`Array of rows, f2 row member null string: ${f2Nullable}, f2 comment ${f2Comment}, row nullable: ${individualRowNullable}, row comment ${rowComment}`, () => {
                // An array of rows, each with two fields, the second of which may be nullable.
                const fullDataType = `ARRAY<ROW<\`f1\` INT, \`f2\` STRING ${f2Nullable} ${f2Comment}> ${individualRowNullable} ${rowComment}>`;
                const col = relationColumnFactory({
                  ...fieldDefaults,
                  name: "my_row_array",
                  fullDataType: fullDataType,
                  comment: null,
                });
                assert.ok(
                  col instanceof CompositeFlinkRelationColumn &&
                    !(col instanceof MapFlinkRelationColumn),
                  "Is CompositeFlinkRelationColumn",
                );
                assert.strictEqual(col.name, "my_row_array", "Name");
                assert.strictEqual(col.simpleDataType, "ROW", "Simple data type");
                assert.strictEqual(col.isArray, true, "Is array");
                assert.strictEqual(
                  col.isArrayMemberNullable,
                  expectedNullability(individualRowNullable),
                  "whole row member is nullable",
                );
                assert.strictEqual(col.isNullable, false, "array as a whole is nullable");
                assert.strictEqual(col.simpleTypeWithArray, "ARRAY<ROW>", "simpleTypeWithArray");
                assert.strictEqual(col.comment, expectedComment(rowComment), "Row Comment");
                assert.strictEqual(col.columns.length, 2, "Field count");
                assert.strictEqual(col.columns[0].name, "f1", "Field 1 name");
                assert.strictEqual(col.columns[0].fullDataType, "INT", "Field 1 data type");
                assert.strictEqual(col.columns[0].isNullable, false, "Field 1 nullable");
                assert.strictEqual(col.columns[1].name, "f2", "Field 2 name");
                assert.strictEqual(col.columns[1].fullDataType, "STRING", "Field 2 data type");
                assert.strictEqual(
                  col.columns[1].isNullable,
                  expectedNullability(f2Nullable),
                  "Field 2 nullable",
                );
                assert.strictEqual(
                  col.columns[1].comment,
                  expectedComment(f2Comment),
                  "Field 2 comment",
                );
              });
            }
          }
        }
      }
    });

    describe("Multidimensional arrays", () => {
      for (const arrayNullability of nullabilitiyStrings) {
        for (const scalarNullability of nullabilitiyStrings) {
          it(`Array of array of INT: scalar nullable: ${scalarNullability}; array nullability ${arrayNullability}`, () => {
            const col = relationColumnFactory({
              ...fieldDefaults,
              name: "my_2d_array",
              fullDataType: `ARRAY<ARRAY<INT ${scalarNullability}>> ${arrayNullability}`,
              comment: null,
            });
            assert.ok(
              col instanceof FlinkRelationColumn &&
                !(col instanceof CompositeFlinkRelationColumn) &&
                !(col instanceof MapFlinkRelationColumn),
              "Is FlinkRelationColumn",
            );
            assert.strictEqual(col.name, "my_2d_array", "Name");
            assert.strictEqual(col.simpleDataType, "INT", "Simple data type");
            assert.strictEqual(col.formattedSimpleDataType, "INT[][]", "simpleTypeWithArray");
            assert.strictEqual(col.simpleTypeWithArray, "ARRAY<ARRAY<INT>>", "simpleTypeWithArray");
            assert.strictEqual(col.isArray, true, "is array");
            assert.strictEqual(
              col.isArrayMemberNullable,
              expectedNullability(scalarNullability),
              "array member nullable",
            );
            assert.strictEqual(col.arrayDimensions, 2, "array dimensions");
            assert.strictEqual(
              col.isNullable,
              expectedNullability(arrayNullability),
              "top level array nullable",
            );
          });
        }
      }
    });

    describe("Maps", () => {
      const memberTypes = ["STRING", "INT"];
      for (const mapNullability of nullabilitiyStrings) {
        for (const keyNullability of nullabilitiyStrings) {
          for (const valueNullability of nullabilitiyStrings) {
            for (const keyType of memberTypes) {
              for (const valueType of memberTypes) {
                it(`Map<${keyType} ${keyNullability}, ${valueType} ${valueNullability}> with nullability ${mapNullability}`, () => {
                  const col = relationColumnFactory({
                    ...fieldDefaults,
                    name: "my_map",
                    fullDataType: `MAP<${keyType} ${keyNullability}, ${valueType} ${valueNullability}> ${mapNullability}`,
                    comment: null,
                  });
                  assert.ok(col instanceof MapFlinkRelationColumn, "Is MapFlinkRelationColumn");
                  assert.strictEqual(col.name, "my_map", "Name");
                  assert.strictEqual(col.simpleDataType, "MAP", "Simple data type");
                  assert.strictEqual(col.isArray, false, "is not array");
                  assert.strictEqual(
                    col.isNullable,
                    expectedNullability(mapNullability),
                    "map nullable",
                  );
                  assert.strictEqual(col.keyColumn.simpleDataType, keyType, "key type");
                  assert.strictEqual(
                    col.keyColumn.isNullable,
                    expectedNullability(keyNullability),
                    "key nullability",
                  );

                  assert.strictEqual(col.valueColumn.simpleDataType, valueType, "value type");
                  assert.strictEqual(
                    col.valueColumn.isNullable,
                    expectedNullability(valueNullability),
                    "value nullability",
                  );
                });
              }
            }
          }
        }
      }
    });
  });
});

function expectedComment(comment: string): string | null {
  if (comment === "") {
    return null;
  }
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
