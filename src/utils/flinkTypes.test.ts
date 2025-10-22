import assert from "assert";
import { describe, it } from "mocha";

import { formatSqlType } from "./flinkTypes";

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
});
