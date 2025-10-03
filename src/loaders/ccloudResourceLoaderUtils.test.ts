import * as assert from "assert";

import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { makeUdfFunctionRow, makeUdfParameterRow } from "../../tests/unit/testResources/makeUdfRow";
import {
  getUdfSystemCatalogQuery,
  RawUdfSystemCatalogRow,
  sortUdfSystemCatalogRows,
  transformUdfSystemCatalogRows,
} from "./ccloudResourceLoaderUtils";

describe("loaders/ccloudResourceLoaderUtils.ts", () => {
  describe("getUdfSystemCatalogQuery()", () => {
    // This function is trivial, just returns a constant string with the cluster ID filled in twice.
    // Ensure is mentioned twice. Only E2E / clicktesting can prove that the query is otherwise sound.
    it("should return string with cluster's id mixed in 2x", () => {
      const query = getUdfSystemCatalogQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
      const occurrences = query.match(new RegExp(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id, "g"));
      assert.ok(occurrences);
      assert.strictEqual(occurrences.length, 2);
    });
  });

  describe("transformUDFSystemCatalogRows()", () => {
    it("should balk if encounters repeated function rows describing same functionSpecificName", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }), // duplicate
      ];
      assert.throws(
        () => transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows),
        /Duplicate/,
      );
    });

    it("should transform a simple function with no parameters", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 1);
      const udf = udfs[0];
      assert.strictEqual(udf.name, "A");
      assert.strictEqual(udf.id, "A-1");
      assert.strictEqual(udf.parameters.length, 0);
    });

    it("should transform a function with parameters", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfParameterRow("A", "param1", 1, { dataType: "INT", isOptional: false }),
        makeUdfParameterRow("A", "param2", 2, {
          dataType: "STRING",
          isOptional: true,
          traits: ["VARIADIC"],
        }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 1);
      const udf = udfs[0];
      assert.strictEqual(udf.name, "A");
      assert.strictEqual(udf.id, "A-1");
      assert.strictEqual(udf.parameters.length, 2);
      assert.deepStrictEqual(udf.parameters[0], {
        name: "param1",
        dataType: "INT",
        isOptional: false,
        traits: [],
      });
      assert.deepStrictEqual(udf.parameters[1], {
        name: "param2",
        dataType: "STRING",
        isOptional: true,
        traits: ["VARIADIC"],
      });
    });

    it("should transform multiple functions with parameters", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfParameterRow("A", "param1", 1, { dataType: "INT", isOptional: false }),
        makeUdfParameterRow("A", "param2", 2, {
          dataType: "STRING",
          isOptional: true,
          traits: ["VARIADIC"],
        }),
        makeUdfFunctionRow("B", { functionSpecificName: "B-1" }),
        makeUdfParameterRow("B", "param1", 1, { dataType: "BOOLEAN", isOptional: false }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 2);

      const udfA = udfs.find((u) => u.name === "A");
      assert.ok(udfA);
      assert.strictEqual(udfA?.id, "A-1");
      assert.strictEqual(udfA?.parameters.length, 2);
      assert.deepStrictEqual(udfA?.parameters[0], {
        name: "param1",
        dataType: "INT",
        isOptional: false,
        traits: [],
      });
      assert.deepStrictEqual(udfA?.parameters[1], {
        name: "param2",
        dataType: "STRING",
        isOptional: true,
        traits: ["VARIADIC"],
      });

      const udfB = udfs.find((u) => u.name === "B");
      assert.ok(udfB);
      assert.strictEqual(udfB?.id, "B-1");
      assert.strictEqual(udfB?.parameters.length, 1);
      assert.deepStrictEqual(udfB?.parameters[0], {
        name: "param1",
        dataType: "BOOLEAN",
        isOptional: false,
        traits: [],
      });
    });

    it("Should handle two functions with the same name but different functionSpecificName (function overloading)", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfFunctionRow("A", { functionSpecificName: "A-2" }),
        makeUdfParameterRow("A", "param1", 1, { functionSpecificName: "A-2", dataType: "INT" }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 2);
      const udf1 = udfs.find((u) => u.id === "A-1");
      assert.ok(udf1);
      assert.strictEqual(udf1?.name, "A");
      assert.strictEqual(udf1?.parameters.length, 0);
      const udf2 = udfs.find((u) => u.id === "A-2");
      assert.ok(udf2);
      assert.strictEqual(udf2?.name, "A");
      assert.strictEqual(udf2?.parameters.length, 1);
    });

    it("Should handle parameters with multiple traits", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfParameterRow("A", "param1", 1, {
          dataType: "INT",
          isOptional: false,
          traits: ["VARIADIC", "OTHER"], // makeParameterRow will join these with ";"
        }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 1);
      const udf = udfs[0];
      assert.strictEqual(udf.parameters.length, 1);
      assert.deepStrictEqual(udf.parameters[0], {
        name: "param1",
        dataType: "INT",
        isOptional: false,
        traits: ["VARIADIC", "OTHER"], // unpacked back to array.
      });
    });

    it("Should handle parameters with no traits", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfParameterRow("A", "param1", 1, {
          dataType: "INT",
          isOptional: false,
          traits: [], // makeParameterRow will end up making this an empty string
        }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 1);
      const udf = udfs[0];
      assert.strictEqual(udf.parameters.length, 1);
      assert.deepStrictEqual(udf.parameters[0], {
        name: "param1",
        dataType: "INT",
        isOptional: false,
        traits: [], // unpacked back to empty array.
      });
    });

    it("Should honor parameter isOptional being YES or NO", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfParameterRow("A", "param1", 1, {
          dataType: "INT",
          isOptional: true,
        }),
        makeUdfParameterRow("A", "param2", 2, {
          dataType: "STRING",
          isOptional: false,
        }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 1);
      const paramOptionality = udfs[0].parameters.map((p) => p.isOptional);
      assert.deepStrictEqual(paramOptionality, [true, false]);
    });

    it("Should honor parameter datatype", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A"),
        makeUdfParameterRow("A", "param1", 1, { dataType: "INT" }),
        makeUdfParameterRow("A", "param2", 2, { dataType: "STRING" }),
        makeUdfParameterRow("A", "param3", 3, { dataType: "BOOLEAN" }),
      ];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 1);
      const paramDataTypes = udfs[0].parameters.map((p) => p.dataType);
      assert.deepStrictEqual(paramDataTypes, ["INT", "STRING", "BOOLEAN"]);
    });

    it("Should raise exception if parameter row has no function row", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        // make function A row, then two params for it, then a param for function B but no function B row,
        // then finally a function C row. The B param should cause an error.
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfParameterRow("A", "param1", 1),
        makeUdfParameterRow("A", "param2", 2),
        makeUdfParameterRow("missing-B", "param1", 1), // no B function definitoin row, straight to param row
        makeUdfFunctionRow("C", { functionSpecificName: "C-1" }),
      ];
      assert.throws(
        () => transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows),
        /Unexpected parameter row.*missing-B/,
      );
    });

    it("Should raise exception if parameter row is encountered before any function row", () => {
      const rows: RawUdfSystemCatalogRow[] = [makeUdfParameterRow("A", "param1", 1)];
      assert.throws(
        () => transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows),
        /Unexpected parameter row.*A-1/,
      );
    });

    it("Should raise exception if parameter row duplicates parameterOrdinalPosition for the same function", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A"),
        makeUdfParameterRow("A", "param1", 1),
        makeUdfParameterRow("A", "param2", 1), // duplicate position
      ];
      assert.throws(
        () => transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows),
        /Duplicate parameter position 1 for functionSpecificName A-1/,
      );
    });

    it("Should handle empty input", () => {
      const rows: RawUdfSystemCatalogRow[] = [];
      const udfs = transformUdfSystemCatalogRows(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, rows);
      assert.strictEqual(udfs.length, 0);
    });
  });

  describe("sortUdfSystemCatalogRows()", () => {
    it("should sort by functionSpecificName", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfFunctionRow("A", { functionSpecificName: "A-2" }),
        makeUdfFunctionRow("B", { functionSpecificName: "B-1" }),
        makeUdfFunctionRow("A", { functionSpecificName: "A-1" }),
        makeUdfFunctionRow("C", { functionSpecificName: "C-1" }),
      ];
      const sorted = sortUdfSystemCatalogRows(rows);
      const sortedNames = sorted.map((r) => r.functionSpecificName);
      // Expect A-1, A-2, B-1, C-1
      assert.deepStrictEqual(sortedNames, ["A-1", "A-2", "B-1", "C-1"]);
    });

    it("should sort parameters after function row, in ordinal position order", () => {
      const rows: RawUdfSystemCatalogRow[] = [
        makeUdfParameterRow("A", "param2", 2),
        makeUdfFunctionRow("A"),
        makeUdfParameterRow("A", "param1", 1),
        makeUdfParameterRow("B", "param1", 1),
        makeUdfFunctionRow("C"),
        makeUdfFunctionRow("B"),
        makeUdfParameterRow("A", "param3", 3),
      ];
      const sorted = sortUdfSystemCatalogRows(rows);
      const sortedNamesAndPositions = sorted.map((r) => ({
        name: r.functionRoutineName,
        position: r.parameterOrdinalPosition,
      }));
      // Expect A function row, then its params in order, then B function row, then its param, then bare C function row
      assert.deepStrictEqual(sortedNamesAndPositions, [
        { name: "A", position: null },
        { name: "A", position: 1 },
        { name: "A", position: 2 },
        { name: "A", position: 3 },
        { name: "B", position: null },
        { name: "B", position: 1 },
        { name: "C", position: null },
      ]);
    });
  });
});
