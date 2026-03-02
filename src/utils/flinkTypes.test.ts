import assert from "assert";
import { describe, it } from "mocha";

import { formatSqlType, formatFlinkTypeForDisplay, getIconForFlinkType } from "./flinkTypes";
import { IconNames } from "../icons";
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
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "INT",
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
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "VARCHAR(255)",
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
        isFieldNullable: true,
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "DECIMAL(10,2)");
    });

    it("should clean max varchar size in ARRAY elements", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "VARCHAR(2147483647)",
            isFieldNullable: true,
          },
        ],
      };
      const result = formatFlinkTypeForDisplay(flinkType);
      assert.strictEqual(result, "VARCHAR[]");
    });
  });

  describe("getIconForFlinkType", () => {
    it("should return FLINK_TYPE_ROW for ROW types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ROW,
        dataType: "ROW",
        isFieldNullable: true,
        members: [],
      };
      const result = getIconForFlinkType(flinkType);
      assert.strictEqual(result, IconNames.FLINK_TYPE_ROW);
    });

    it("should return FLINK_TYPE_ARRAY for ARRAY types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "INT",
            isFieldNullable: true,
          },
        ],
      };
      const result = getIconForFlinkType(flinkType);
      assert.strictEqual(result, IconNames.FLINK_TYPE_ARRAY);
    });

    it("should return FLINK_TYPE_MULTISET for MULTISET types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.MULTISET,
        dataType: "MULTISET",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "VARCHAR",
            isFieldNullable: true,
          },
        ],
      };
      const result = getIconForFlinkType(flinkType);
      assert.strictEqual(result, IconNames.FLINK_TYPE_MULTISET);
    });

    it("should return FLINK_TYPE_MULTISET (not ARRAY) for MULTISET with ROW", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.MULTISET,
        dataType: "MULTISET",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.ROW,
            dataType: "ROW",
            isFieldNullable: true,
            members: [],
          },
        ],
      };
      const result = getIconForFlinkType(flinkType);
      assert.strictEqual(result, IconNames.FLINK_TYPE_MULTISET);
    });

    it("should return FLINK_FUNCTION for MAP types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.MAP,
        dataType: "MAP",
        isFieldNullable: true,
        members: [],
      };
      const result = getIconForFlinkType(flinkType);
      assert.strictEqual(result, IconNames.FLINK_FUNCTION);
    });

    it("should return FLINK_FUNCTION for scalar types", () => {
      const flinkType: FlinkType = {
        kind: FlinkTypeKind.SCALAR,
        dataType: "INT",
        isFieldNullable: true,
      };
      const result = getIconForFlinkType(flinkType);
      assert.strictEqual(result, IconNames.FLINK_FUNCTION);
    });

    it("should distinguish ARRAY and MULTISET icons", () => {
      const arrayType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "INT",
            isFieldNullable: true,
          },
        ],
      };
      const multisetType: FlinkType = {
        kind: FlinkTypeKind.MULTISET,
        dataType: "MULTISET",
        isFieldNullable: true,
        members: [
          {
            kind: FlinkTypeKind.SCALAR,
            dataType: "INT",
            isFieldNullable: true,
          },
        ],
      };
      const arrayIcon = getIconForFlinkType(arrayType);
      const multisetIcon = getIconForFlinkType(multisetType);
      assert.strictEqual(arrayIcon, IconNames.FLINK_TYPE_ARRAY);
      assert.strictEqual(multisetIcon, IconNames.FLINK_TYPE_MULTISET);
      assert.notStrictEqual(arrayIcon, multisetIcon);
    });
  });
});
