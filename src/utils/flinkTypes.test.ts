import assert from "assert";
import { describe, it } from "mocha";

import { formatSqlType, formatFlinkTypeForDisplay } from "./flinkTypes";
import type { FlinkType } from "../models/flinkTypes";
import { FlinkTypeKind } from "../models/flinkTypes";

describe("flinkTypes.ts", () => {
  describe("formatSqlType", () => {
    it("should remove max varchar size", () => {
      const result = formatSqlType("VARCHAR(2147483647)");
      assert.strictEqual(result, "VARCHAR");
    });

    it("should preserve small varchar sizes", () => {
      const result = formatSqlType("VARCHAR(100)");
      assert.strictEqual(result, "VARCHAR(100)");
    });

    it("should remove backticks", () => {
      const result = formatSqlType("ROW<`field` VARCHAR>");
      assert.strictEqual(result, "ROW<field VARCHAR>");
    });

    it("should handle complex types with max varchar and backticks", () => {
      const result = formatSqlType("ROW<`name` VARCHAR(2147483647), `age` INT>");
      assert.strictEqual(result, "ROW<name VARCHAR, age INT>");
    });
  });

  describe("formatFlinkTypeForDisplay", () => {
    it("should return 'ROW' for ROW types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ROW,
        dataType: "ROW",
        fullDataTypeString: "ROW<>",
        isFieldNullable: true,
        members: [],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "ROW");
    });

    it("should return 'MAP' for MAP types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.MAP,
        dataType: "MAP",
        fullDataTypeString: "MAP<>",
        isFieldNullable: true,
        members: [],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "MAP");
    });

    it("should format ARRAY types with element type", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        fullDataTypeString: "INT ARRAY",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "INT",
            fullDataTypeString: "INT",
            isFieldNullable: true,
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "INT[]");
    });

    it("should format MULTISET types with element type", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.MULTISET,
        dataType: "MULTISET",
        fullDataTypeString: "VARCHAR(255) MULTISET",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "VARCHAR(255)",
            fullDataTypeString: "VARCHAR(255)",
            isFieldNullable: true,
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "VARCHAR(255) MULTISET");
    });

    it("should format scalar types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.SCALAR,
        dataType: "DECIMAL(10,2)",
        fullDataTypeString: "DECIMAL(10,2)",
        isFieldNullable: true,
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "DECIMAL(10,2)");
    });

    it("should clean max varchar size in ARRAY elements", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        fullDataTypeString: "VARCHAR ARRAY",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "VARCHAR(2147483647)",
            fullDataTypeString: "VARCHAR(2147483647)",
            isFieldNullable: true,
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "VARCHAR[]");
    });

    it("should format ARRAY<ROW> with proper nesting", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        fullDataTypeString: "ARRAY<ROW<>>",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.ROW,
            dataType: "ROW",
            fullDataTypeString: "ROW<>",
            isFieldNullable: true,
            members: [],
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "ROW[]");
    });

    it("should format nested ARRAY<ARRAY<INT>> correctly", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        fullDataTypeString: "ARRAY<ARRAY<INT>>",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.ARRAY,
            dataType: "ARRAY",
            fullDataTypeString: "ARRAY<INT>",
            isFieldNullable: true,
            members: [
              {
                kind: FlinkTypeKind.SCALAR,
                dataType: "INT",
                fullDataTypeString: "INT",
                isFieldNullable: true,
              },
            ],
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "INT[][]");
    });

    it("should format ARRAY<MULTISET<INT>> correctly", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        fullDataTypeString: "ARRAY<MULTISET<INT>>",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.MULTISET,
            dataType: "MULTISET",
            fullDataTypeString: "MULTISET<INT>",
            isFieldNullable: true,
            members: [
              {
                kind: FlinkTypeKind.SCALAR,
                dataType: "INT",
                fullDataTypeString: "INT",
                isFieldNullable: true,
              },
            ],
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "INT MULTISET[]");
    });

    it("should format MULTISET<ARRAY<INT>> correctly", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.MULTISET,
        dataType: "MULTISET",
        fullDataTypeString: "MULTISET<ARRAY<INT>>",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.ARRAY,
            dataType: "ARRAY",
            fullDataTypeString: "ARRAY<INT>",
            isFieldNullable: true,
            members: [
              {
                kind: FlinkTypeKind.SCALAR,
                dataType: "INT",
                fullDataTypeString: "INT",
                isFieldNullable: true,
              },
            ],
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "INT[] MULTISET");
    });
  });
});
