import assert from "assert";
import { describe, it } from "mocha";
import { createFlinkUDF } from "../../tests/unit/testResources/flinkUDF";
import { FlinkUdfParameter, FlinkUdfTreeItem, createFlinkUdfToolTip } from "./flinkUDF";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ConnectionType } from "../clients/sidecar";

describe("FlinkUdfParameter", () => {
  describe("formatSqlType", () => {
    it("should remove max varchar size", () => {
      const result = FlinkUdfParameter.formatSqlType("VARCHAR(2147483647)");
      assert.strictEqual(result, "VARCHAR");
    });

    it("should preserve small varchar sizes", () => {
      const result = FlinkUdfParameter.formatSqlType("VARCHAR(100)");
      assert.strictEqual(result, "VARCHAR(100)");
    });

    it("should remove backticks", () => {
      const result = FlinkUdfParameter.formatSqlType("ROW<`field` VARCHAR>");
      assert.strictEqual(result, "ROW<field VARCHAR>");
    });

    it("should handle complex types with max varchar and backticks", () => {
      const result = FlinkUdfParameter.formatSqlType("ROW<`name` VARCHAR(2147483647), `age` INT>");
      assert.strictEqual(result, "ROW<name VARCHAR, age INT>");
    });
  });
});

describe("FlinkUdf", () => {
  it("should return correct details", () => {
    const udf = createFlinkUDF("testFunc");
    assert.strictEqual(udf.connectionId, CCLOUD_CONNECTION_ID);
    assert.strictEqual(udf.connectionType, ConnectionType.Ccloud);
  });

  describe("artifactReferenceExtracted", () => {
    it("should extract artifact ID and version", () => {
      const udf = createFlinkUDF("testFunc", undefined, {
        artifactReference: "confluent-artifact://abc123/v1.2.3",
      });
      assert.strictEqual(udf.artifactReferenceExtracted, "abc123/v1.2.3");
    });

    it("should return original if not standard format", () => {
      const udf = createFlinkUDF("testFunc", undefined, {
        artifactReference: "custom-format:123",
      });
      assert.strictEqual(udf.artifactReferenceExtracted, "custom-format:123");
    });
  });

  describe("FlinkUdfTreeItem", () => {
    it("should have the correct context value and resource", () => {
      const udf = createFlinkUDF("testFunc");
      const treeItem = new FlinkUdfTreeItem(udf);
      assert.strictEqual(treeItem.contextValue, "ccloud-flink-udf");
      assert.strictEqual(treeItem.resource, udf);
    });

    it("should format return type in description", () => {
      const udf = createFlinkUDF("testFunc", undefined, {
        returnType: "VARCHAR(2147483647)",
      });
      const treeItem = new FlinkUdfTreeItem(udf);
      assert.strictEqual(treeItem.description, "→ VARCHAR");
    });
  });

  describe("createFlinkUdfToolTip", () => {
    it("should format tooltip with all UDF details", () => {
      const udf = createFlinkUDF("testFunc", undefined, {
        returnType: "VARCHAR(2147483647)",
        isDeterministic: true,
      });
      udf.parameters = [
        new FlinkUdfParameter({
          name: "input",
          dataType: "VARCHAR(2147483647)",
          isOptional: false,
          traits: [],
        }),
      ];
      const tooltip = createFlinkUdfToolTip(udf);

      assert.match(tooltip.value, /Return Type: `VARCHAR`/);
      assert.match(tooltip.value, /Deterministic: `Yes`/);
      assert.match(tooltip.value, /Parameters: `\(input : VARCHAR\)`/);
    });

    it("should show None for empty parameters", () => {
      const udf = createFlinkUDF("testFunc");
      const tooltip = createFlinkUdfToolTip(udf);
      assert.match(tooltip.value, /Parameters: `None`/);
    });
  });
});
