import * as assert from "assert";

import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import { makeColumnRow, makeRelationRow } from "../../../tests/unit/testResources/makeRelationRow";
import {
  getRelationsAndColumnsSystemCatalogQuery,
  parseRelationsAndColumnsSystemCatalogQueryResponse,
} from "./relationsAndColumnsSystemCatalogQuery";

describe("relationsAndColumnsSystemCatalogQuery.ts", () => {
  describe("getRelationsAndColumnsSystemCatalogQuery()", () => {
    // This function is trivial, just returns a constant string with the cluster ID filled in twice.
    // Ensure is mentioned thrice. Only E2E / clicktesting can prove that the query is otherwise sound.
    it("should return string with cluster's id mixed in 3x", () => {
      const query = getRelationsAndColumnsSystemCatalogQuery(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
      const occurrences = query.match(new RegExp(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id, "g"));
      assert.ok(occurrences);
      assert.strictEqual(occurrences.length, 3);
    });
  });

  describe("parseRelationsAndColumnsSystemCatalogQueryResponse()", () => {
    it("raises exception if a column is mentioned without its relation coming first", () => {
      const rows = [
        makeRelationRow("relation1"),
        makeColumnRow("relation1", "column1", 1),
        makeColumnRow("relation2", "column1", 1), // relation2 row missing
      ];
      assert.throws(() => {
        parseRelationsAndColumnsSystemCatalogQueryResponse(rows);
      }, /does not match current relation/);
    });

    it("raises exception if only columns are mentioned (no relations)", () => {
      const rows = [
        makeColumnRow("relation1", "column1", 1), // relation1 row missing
      ];
      assert.throws(() => {
        parseRelationsAndColumnsSystemCatalogQueryResponse(rows);
      }, /does not match current relation/);
    });

    it("parses relations and columns correctly", () => {
      const rows = [
        // columns coming before their relation should be sorted properly beforehand.
        makeColumnRow("relation1", "column1", 1, {
          fullDataType: "VARCHAR(255)",
          isNullable: "YES",
          comment: "Column 1 comment",
          distributionKeyNumber: 1,
        }),
        makeColumnRow("relation1", "column2", 2, {
          fullDataType: "INT",
          isNullable: "NO",
          comment: null,
          distributionKeyNumber: null,
        }),

        makeRelationRow("relation1", {
          comment: "Relation 1 comment",
          type: "BASE TABLE",
          distributionBucketCount: 8,
          isDistributed: "YES",
          isWatermarked: "NO",
          watermarkColumnIsHidden: "NO",
        }),

        makeRelationRow("relation2", {
          comment: null,
          type: "VIEW",
          distributionBucketCount: 0,
          isDistributed: "NO",
          isWatermarked: "YES",
          watermarkColumnIsHidden: "NO",
          watermarkColumn: "colA",
          watermarkExpression: "colA - INTERVAL '1' MINUTE",
        }),
        makeColumnRow("relation2", "colA", 1, {
          fullDataType: "TIMESTAMP",
          isNullable: "YES",
        }),
      ];

      const relations = parseRelationsAndColumnsSystemCatalogQueryResponse(rows);
      assert.strictEqual(relations.length, 2);

      const relation1 = relations[0];
      assert.strictEqual(relation1.name, "relation1");
      assert.strictEqual(relation1.comment, "Relation 1 comment");
      assert.strictEqual(relation1.type, "BASE TABLE");
      assert.strictEqual(relation1.distributionBucketCount, 8);
      assert.strictEqual(relation1.isDistributed, true);
      assert.strictEqual(relation1.isWatermarked, false);
      assert.strictEqual(relation1.columns.length, 2);

      const relation1Col1 = relation1.columns[0];
      assert.strictEqual(relation1Col1.name, "column1");
      assert.strictEqual(relation1Col1.fullDataType, "VARCHAR(255)");
      assert.strictEqual(relation1Col1.isNullable, true);
      assert.strictEqual(relation1Col1.comment, "Column 1 comment");
      assert.strictEqual(relation1Col1.distributionKeyNumber, 1);

      const relation1Col2 = relation1.columns[1];
      assert.strictEqual(relation1Col2.name, "column2");
      assert.strictEqual(relation1Col2.fullDataType, "INT");
      assert.strictEqual(relation1Col2.isNullable, false);
      assert.strictEqual(relation1Col2.comment, null);
      assert.strictEqual(relation1Col2.distributionKeyNumber, null);

      const relation2 = relations[1];
      assert.strictEqual(relation2.name, "relation2");
      assert.strictEqual(relation2.comment, null);
      assert.strictEqual(relation2.type, "VIEW");
      assert.strictEqual(relation2.distributionBucketCount, 0);
      assert.strictEqual(relation2.isDistributed, false);
      assert.strictEqual(relation2.isWatermarked, true);
      assert.strictEqual(relation2.watermarkColumnName, "colA");
      assert.strictEqual(relation2.watermarkExpression, "colA - INTERVAL '1' MINUTE");
      assert.strictEqual(relation2.columns.length, 1);

      const relation2ColA = relation2.columns[0];
      assert.strictEqual(relation2ColA.name, "colA");
      assert.strictEqual(relation2ColA.fullDataType, "TIMESTAMP");
      assert.strictEqual(relation2ColA.isNullable, true);
    });
  });
});
