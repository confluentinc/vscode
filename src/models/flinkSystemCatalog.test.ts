import assert from "assert";
import { describe, it } from "mocha";
import { createFlinkUDF } from "../../tests/unit/testResources/flinkUDF";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import {
  FlinkUdfParameter,
  FlinkUdfTreeItem,
  createFlinkUdfToolTip,
  formatSqlType,
} from "./flinkSystemCatalog";

describe("flinkUDF.ts", () => {
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

  describe("FlinkUdf", () => {
    describe("constructor", () => {
      it("should convert date strings to Date objects when rehydrating from cache", () => {
        // simulate when dates are stored as strings after JSON.stringify() when retrieved from cache
        const original = createFlinkUDF("testFunc");
        const deserialized = JSON.parse(JSON.stringify(original));

        assert.strictEqual(typeof deserialized.creationTs, "string");

        // constructor should convert string back to Date object
        const rehydrated = createFlinkUDF("testFunc", undefined, deserialized);
        assert.ok(rehydrated.creationTs instanceof Date);
        assert.strictEqual(rehydrated.creationTs.toISOString(), original.creationTs.toISOString());

        // verify timezone formatting works
        const localeString = rehydrated.creationTs.toLocaleString(undefined, {
          timeZoneName: "short",
        });
        assert.notStrictEqual(localeString, rehydrated.creationTs.toISOString());
      });
    });

    describe("getters", () => {
      it("get connectionId(), get connectionType() smell like CCloud", () => {
        const udf = createFlinkUDF("testFunc");
        assert.strictEqual(udf.connectionId, CCLOUD_CONNECTION_ID);
        assert.strictEqual(udf.connectionType, ConnectionType.Ccloud);
      });
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

    describe("searchableText", () => {
      it("should return a concatenated string of searchable fields", () => {
        const udf = createFlinkUDF("searchTestUDF", undefined, {
          description: "Test UDF description",
          externalName: "com.example.searchTest",
          artifactReference: "confluent-artifact://artifact123/v1.0.0",
          kind: "SCALAR",
        });
        const searchText = udf.searchableText();

        assert.ok(searchText.includes("searchTestUDF"));
        assert.ok(searchText.includes("Test UDF description"));
        assert.ok(searchText.includes("com.example.searchTest"));
        assert.ok(searchText.includes("confluent-artifact://artifact123/v1.0.0"));
        assert.ok(searchText.includes("SCALAR"));
      });
    });

    describe("parameterSignature", () => {
      it("should return formatted parameter signature", () => {
        const udf = createFlinkUDF("paramSigUDF");
        udf.parameters = [
          new FlinkUdfParameter({
            name: "param1",
            dataType: "INT",
            isOptional: false,
            traits: [],
          }),
          new FlinkUdfParameter({
            name: "param2",
            dataType: "VARCHAR(2147483647)",
            isOptional: true,
            traits: [],
          }),
        ];
        assert.strictEqual(udf.parametersSignature, "(param1 : INT, param2 : VARCHAR)");
      });

      it("should return empty parentheses for no parameters", () => {
        const udf = createFlinkUDF("noParamUDF");
        const signature = udf.parametersSignature;
        assert.strictEqual(signature, "()");
      });
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
      assert.strictEqual(treeItem.description, "() → VARCHAR");
    });
  });

  describe("createFlinkUdfToolTip", () => {
    it("should format tooltip with all UDF details", () => {
      const udf = createFlinkUDF("testFunc", undefined, {
        returnType: "VARCHAR(2147483647)",
        externalName: "com.example.testFunc",
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
      assert.match(tooltip.value, /External Name: `com\.example\.testFunc`/);
      assert.match(tooltip.value, /Parameters: `\(input : VARCHAR\)`/);
    });

    it("should show None for empty parameters", () => {
      const udf = createFlinkUDF("testFunc");
      const tooltip = createFlinkUdfToolTip(udf);
      assert.match(tooltip.value, /Parameters: `None`/);
    });
  });
});
