import * as assert from "assert";
import { Operation } from "./flinkStatementResults";

import {
  generateRowId,
  INTERNAL_COUNT_KEEP_LAST_ROW,
  parseResults,
  validateUUIDSuffix,
} from "./flinkStatementResults";

describe("utils/flinkStatementResults", () => {
  describe("parseResults", () => {
    it("returns original map if rows are null or empty", () => {
      const columns = [
        {
          name: "id",
          type: { nullable: false, type: "INTEGER" },
        },
        {
          name: "users",
          type: { nullable: false, type: "INTEGER" },
        },
      ];
      const rows1 = null;
      const resMap1 = parseResults({ columns, isAppendOnly: false, map: new Map(), rows: rows1 });
      assert.equal(resMap1.size, 0);

      const rows2: any[] = [];
      const resMap2 = parseResults({ columns, isAppendOnly: false, map: new Map(), rows: rows2 });
      assert.equal(resMap2.size, 0);
    });

    it("returns correct results with different operations", () => {
      const columns = [
        {
          name: "id",
          type: { nullable: false, type: "INTEGER" },
        },
        {
          name: "users",
          type: { nullable: false, type: "INTEGER" },
        },
      ];
      const rows = [
        { op: Operation.Insert, row: [1, 10] },
        { op: Operation.Insert, row: [2, 20] },
        { op: Operation.UpdateBefore, row: [2, 20] },
        { op: Operation.UpdateAfter, row: [2, 0] },
        { op: Operation.Delete, row: [1, 10] },
      ];
      const resMap = parseResults({
        columns,
        rows,
        isAppendOnly: false,
        map: new Map(),
        upsertColumns: [0, 1],
      });
      const res = Array.from(resMap, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));

      assert.equal(res.length, 1);
      assert.equal(res[0].INTERNAL_ID, "2-0");
      assert.deepEqual(res[0], { INTERNAL_ID: "2-0", id: 2, users: 0 });
    });

    it("respects is_append_only property", () => {
      // When is_append_only is TRUE
      const columns = [
        {
          name: "CATALOG_NAME",
          type: { nullable: false, type: "VARCHAR" },
        },
      ];
      const rows = [
        {
          op: Operation.Insert,
          row: ["examples"],
        },
        {
          op: Operation.Insert,
          row: ["examples"],
        },
      ];
      const resMap = parseResults({
        columns,
        rows,
        isAppendOnly: true,
        map: new Map(),
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const res = Array.from(resMap, ([_, data]) => ({ ...Object.fromEntries(data) }));

      assert.equal(res.length, 2);
      assert.deepEqual(res[0], { CATALOG_NAME: "examples" });
      assert.deepEqual(res[1], { CATALOG_NAME: "examples" });

      // When is_append_only is FALSE
      const columns2 = [
        {
          name: "EXPR$0",
          type: { nullable: false, type: "BIGINT" },
        },
      ];
      const rows2 = [
        { op: Operation.Insert, row: [1] },
        { op: Operation.UpdateBefore, row: [1] },
        { op: Operation.UpdateAfter, row: [2] },
        { op: Operation.UpdateBefore, row: [2] },
        { op: Operation.UpdateAfter, row: [3] },
        { op: Operation.Insert, row: [1] },
        { op: Operation.UpdateBefore, row: [1] },
        { op: Operation.UpdateAfter, row: [2] },
        { op: Operation.Insert, row: [1] },
        { op: Operation.UpdateBefore, row: [1] },
        { op: Operation.UpdateAfter, row: [2] },
        { op: Operation.UpdateBefore, row: [2] },
        { op: Operation.UpdateAfter, row: [3] },
        { op: Operation.Insert, row: [1] },
        { op: Operation.UpdateBefore, row: [1] },
        { op: Operation.UpdateAfter, row: [2] },
      ];
      const resMap2 = parseResults({
        columns: columns2,
        rows: rows2,
        isAppendOnly: false,
        map: new Map(),
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const res2 = Array.from(resMap2, ([_, data]) => ({ ...Object.fromEntries(data) }));

      assert.equal(res2.length, 4);
      assert.deepEqual(res2[0], { EXPR$0: 3 });
      assert.deepEqual(res2[1], { EXPR$0: 2 });
      assert.deepEqual(res2[2], { EXPR$0: 3 });
      assert.deepEqual(res2[3], { EXPR$0: 2 });
    });

    it("respects upsert_columns property", () => {
      // When upsert_columns is specified
      const columns = [
        {
          name: "s",
          type: {
            nullable: false,
            type: "INTEGER",
          },
        },
        {
          name: "EXPR$1",
          type: {
            nullable: false,
            type: "BIGINT",
          },
        },
      ];
      const rows = [
        { op: Operation.Insert, row: ["1", "1"] },
        { op: Operation.UpdateBefore, row: ["1", "1"] },
        { op: Operation.UpdateAfter, row: ["1", "2"] },
        { op: Operation.UpdateBefore, row: ["1", "2"] },
        { op: Operation.UpdateAfter, row: ["1", "3"] },
        { op: Operation.Insert, row: ["2", "1"] },
        { op: Operation.UpdateBefore, row: ["2", "1"] },
        { op: Operation.UpdateAfter, row: ["2", "2"] },
      ];
      const resMap = parseResults({
        columns,
        rows,
        isAppendOnly: false,
        map: new Map(),
        upsertColumns: [0],
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const res = Array.from(resMap, ([_, data]) => ({ ...Object.fromEntries(data) }));

      assert.equal(res.length, 2);
      assert.deepEqual(res[0], { EXPR$1: "3", s: "1" });
      assert.deepEqual(res[1], { EXPR$1: "2", s: "2" });

      // When upsert_columns is NOT specified
      const columns2 = [
        {
          name: "EXPR$0",
          type: {
            nullable: false,
            type: "BIGINT",
          },
        },
      ];
      const rows2 = [
        { op: Operation.Insert, row: ["1"] },
        { op: Operation.UpdateBefore, row: ["1"] },
        { op: Operation.UpdateAfter, row: ["2"] },
        { op: Operation.UpdateBefore, row: ["2"] },
        { op: Operation.UpdateAfter, row: ["3"] },
        { op: Operation.Insert, row: ["1"] },
        { op: Operation.UpdateBefore, row: ["1"] },
        { op: Operation.UpdateAfter, row: ["2"] },
      ];
      const resMap2 = parseResults({
        columns: columns2,
        rows: rows2,
        isAppendOnly: false,
        map: new Map(),
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const res2 = Array.from(resMap2, ([_, data]) => ({ ...Object.fromEntries(data) }));

      assert.equal(res2.length, 2);
      assert.deepEqual(res2[0], { EXPR$0: "3" });
      assert.deepEqual(res2[1], { EXPR$0: "2" });
    });

    it("keeps map size up to the provided limit", () => {
      const columns = [
        {
          name: "id",
          type: { nullable: false, type: "INTEGER" },
        },
        {
          name: "users",
          type: { nullable: false, type: "INTEGER" },
        },
      ];
      const rows = [
        { op: Operation.Insert, row: [1, 10] },
        { op: Operation.Insert, row: [2, 20] },
        { op: Operation.Insert, row: [3, 20] },
        { op: Operation.Insert, row: [4, 20] },
        { op: Operation.Insert, row: [5, 20] },
      ];
      const limit1 = 3;
      const resMap = parseResults({
        columns,
        isAppendOnly: false,
        limit: limit1,
        map: new Map(),
        rows,
        upsertColumns: [0, 1],
      });
      assert.equal(resMap.size, limit1);
      // first two items should be dropped
      assert.equal(resMap.keys().next().value, "3-20");

      const limit2 = 4;
      const moreRows = [
        { op: Operation.Insert, row: [6, 20] },
        { op: Operation.Insert, row: [7, 20] },
      ];
      const resMap2 = parseResults({
        columns,
        isAppendOnly: false,
        map: resMap,
        rows: moreRows,
        limit: limit2,
      });
      assert.equal(resMap2.size, limit2);
      // first item should be dropped
      assert.equal(resMap2.keys().next().value, "4-20");
    });

    it("returns correct results with nested data", () => {
      const columns = [
        {
          name: "key",
          type: {
            nullable: true,
            type: "VARBINARY",
          },
        },
        {
          name: "store_id",
          type: { nullable: false, type: "INTEGER" },
        },
        {
          name: "store_order_id",
          type: { nullable: false, type: "INTEGER" },
        },
        {
          name: "coupon_code",
          type: { nullable: false, type: "INTEGER" },
        },
        { name: "date", type: { nullable: false, type: "DATE" } },
        {
          name: "status",
          type: {
            nullable: false,
            type: "VARCHAR",
          },
        },
        {
          name: "order_lines",
          type: {
            element_type: {
              fields: [
                {
                  field_type: { nullable: false, type: "INTEGER" },
                  name: "product_id",
                },
                {
                  field_type: {
                    nullable: false,
                    type: "VARCHAR",
                  },
                  name: "category",
                },
                {
                  field_type: { nullable: false, type: "INTEGER" },
                  name: "quantity",
                },
                {
                  field_type: { nullable: false, type: "DOUBLE" },
                  name: "unit_price",
                },
                {
                  field_type: { nullable: false, type: "DOUBLE" },
                  name: "net_price",
                },
              ],
              nullable: false,
              type: "ROW",
            },
            nullable: false,
            type: "ARRAY",
          },
        },
      ];
      const rows = [
        {
          op: Operation.Insert,
          row: [
            "x'31'",
            "1",
            "1016",
            "1315",
            "2021-12-12",
            "accepted",
            [["37", "pizza", "3", "14.62", "43.86"]],
          ],
        },
        {
          op: Operation.Insert,
          row: [
            "x'31'",
            "1",
            "1034",
            "1615",
            "2019-08-02",
            "accepted",
            [["95", "wings", "3", "15.27", "45.81"]],
          ],
        },
        {
          op: Operation.Insert,
          row: [
            "x'31'",
            "1",
            "1039",
            "1598",
            "2020-06-28",
            "accepted",
            [
              ["97", "dessert", "3", "16.03", "48.09"],
              ["66", "calzone", "4", "18.78", "75.12"],
              ["89", "pizza", "1", "8.81", "8.81"],
              ["83", "salad", "1", "1.66", "1.66"],
            ],
          ],
        },
        {
          op: Operation.Insert,
          row: [
            "x'31'",
            "1",
            "1043",
            "1009",
            "2021-01-26",
            "accepted",
            [
              ["72", "salad", "5", "24.97", "124.85"],
              ["78", "pizza", "2", "11.45", "22.9"],
              ["97", "dessert", "4", "6.62", "26.48"],
              ["36", "calzone", "4", "3.23", "12.92"],
            ],
          ],
        },
      ];

      const resMap = parseResults({
        columns,
        isAppendOnly: false,
        map: new Map(),
        rows,
        upsertColumns: [0, 1, 2, 3, 4, 5, 6, 7],
      });
      const res = Array.from(resMap, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));

      assert.equal(res.length, 4);
      assert.equal(
        res[0].INTERNAL_ID,
        "x'31'-1-1016-1315-2021-12-12-accepted-37,pizza,3,14.62,43.86",
      );
      // @ts-expect-error: test
      assert.equal(res[0].key, "x'31'");
      // @ts-expect-error: test
      assert.deepEqual(res[0].order_lines, [["37", "pizza", "3", "14.62", "43.86"]]);

      // more complex ID example
      assert.equal(
        res[3].INTERNAL_ID,
        "x'31'-1-1043-1009-2021-01-26-accepted-72,salad,5,24.97,124.85,78,pizza,2,11.45,22.9,97,dessert,4,6.62,26.48,36,calzone,4,3.23,12.92",
      );
    });

    it("returns correct results for edge case with user selecting minimum columns resulting in colliding data from API", () => {
      const columns = [
        {
          name: "item",
          type: { nullable: false, type: "STRING" },
        },
        {
          name: "quantity",
          type: { nullable: false, type: "INTEGER" },
        },
      ];
      const rows = [
        { op: Operation.Insert, row: ["bananas", 3] },
        { op: Operation.Insert, row: ["bananas", 8] },
        { op: Operation.Insert, row: ["bananas", 3] },
        { op: Operation.Insert, row: ["apples", 15] },
        { op: Operation.Insert, row: ["apples", 15] },
        { op: Operation.Insert, row: ["apples", 10] },
      ];
      const resMap = parseResults({
        columns,
        isAppendOnly: false,
        map: new Map(),
        rows,
      });
      assert.equal(resMap.size, 6);
    });

    it("works correctly with count query that might have UpdateBefore at the end of the API results", () => {
      const columns = [
        {
          name: "EXPR$0",
          type: { nullable: false, type: "BIGINT" },
        },
      ];
      const rows1 = [{ op: Operation.Insert, row: [1] }];
      const resMap1 = parseResults({
        columns,
        isAppendOnly: false,
        map: new Map(),
        rows: rows1,
      });

      const rows2 = [
        { op: Operation.UpdateBefore, row: [1] },
        { op: Operation.UpdateAfter, row: [2] },
        { op: Operation.UpdateBefore, row: [2] },
      ];
      const resMap2 = parseResults({
        columns,
        isAppendOnly: false,
        map: resMap1,
        rows: rows2,
      });
      assert.equal(resMap2.size, 1);
      assert.equal(resMap2.has(INTERNAL_COUNT_KEEP_LAST_ROW), true);

      const rows3 = [
        { op: Operation.UpdateAfter, row: [3] },
        { op: Operation.UpdateBefore, row: [3] },
        { op: Operation.UpdateAfter, row: [4] },
      ];
      const resMap3 = parseResults({
        columns,
        isAppendOnly: false,
        map: resMap2,
        rows: rows3,
      });
      assert.equal(resMap3.size, 1);
      assert.equal(resMap3.has(INTERNAL_COUNT_KEEP_LAST_ROW), false);
      const res = Array.from(resMap3, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));
      // @ts-expect-error: test
      assert.equal(res[0].EXPR$0, 4);
    });

    it("works correctly with count query that might have UpdateBefore at the end of the API results -- results are grouped", () => {
      // this test covers a case where we need to count rows by a specific column
      // for example, when we have a query like `SELECT op, COUNT(op) FROM table GROUP BY op`
      // the result table should look like this:
      // | op | count |
      // |----|-------|
      // | x  | 111   |
      // | y  | 123   |
      // | z  | 321   |
      // the util should be able to handle this case without row flickering and without duplicates in the map
      // also this util should be able to update the correct row (see `rows3` example)
      const columns = [
        {
          name: "op",
          type: { nullable: false, type: "VARCHAR" },
        },
        {
          name: "count",
          type: { nullable: false, type: "BIGINT" },
        },
      ];

      const rows1 = [
        { op: Operation.Insert, row: ["x", 1] },
        { op: Operation.Insert, row: ["y", 100] },
        { op: Operation.Insert, row: ["z", 1000] },
      ];
      const resMap1 = parseResults({
        columns,
        isAppendOnly: false,
        map: new Map(),
        rows: rows1,
      });
      assert.equal(resMap1.size, 3);

      // regular update, with the last row being UpdateAfter
      const rows2 = [
        { op: Operation.UpdateBefore, row: ["x", 1] },
        { op: Operation.UpdateAfter, row: ["x", 2] },
        { op: Operation.UpdateBefore, row: ["y", 100] },
        { op: Operation.UpdateAfter, row: ["y", 102] },
        { op: Operation.UpdateBefore, row: ["z", 1000] },
        { op: Operation.UpdateAfter, row: ["z", 1002] },
      ];
      const resMap2 = parseResults({
        columns,
        isAppendOnly: false,
        map: resMap1,
        rows: rows2,
      });
      assert.equal(resMap2.size, 3);
      const res2 = Array.from(resMap2, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));
      // @ts-expect-error: test
      assert.equal(res2.find(({ op }) => op === "x")!.count, 2);
      // @ts-expect-error: test
      assert.equal(res2.find(({ op }) => op === "y")!.count, 102);
      // @ts-expect-error: test
      assert.equal(res2.find(({ op }) => op === "z")!.count, 1002);

      // another update, with the last row being UpdateBefore just for one op
      const rows3 = [
        { op: Operation.UpdateBefore, row: ["x", 2] },
        { op: Operation.UpdateAfter, row: ["x", 3] },
        { op: Operation.UpdateBefore, row: ["x", 3] },
        { op: Operation.UpdateAfter, row: ["x", 4] },
        { op: Operation.UpdateBefore, row: ["z", 1002] },
      ];
      const resMap3 = parseResults({
        columns,
        isAppendOnly: false,
        map: resMap2,
        rows: rows3,
      });
      assert.equal(resMap3.size, 3);
      const res3 = Array.from(resMap3, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));
      // @ts-expect-error: test
      assert.equal(res3.find(({ op }) => op === "x")!.count, 4);
      // `y` is unchanged because there was no update at all for this op
      // @ts-expect-error: test
      assert.equal(res3.find(({ op }) => op === "y")!.count, 102);
      // `z` is unchanged because the last operation was UpdateBefore and we are waiting for UpdateAfter immediately in the next batch
      // @ts-expect-error: test
      assert.equal(res3.find(({ op }) => op === "z")!.count, 1002);

      // another update, with the first row being UpdateAfter for one op that was previously flagged with special key
      const rows4 = [
        { op: Operation.UpdateAfter, row: ["z", 1003] },
        { op: Operation.UpdateBefore, row: ["y", 102] },
        { op: Operation.UpdateAfter, row: ["y", 103] },
      ];
      const resMap4 = parseResults({
        columns,
        isAppendOnly: false,
        map: resMap3,
        rows: rows4,
      });
      // there should be no additional rows in the map
      assert.equal(resMap4.size, 3);
      const res4 = Array.from(resMap4, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));
      // @ts-expect-error: test
      assert.equal(res4.find(({ op }) => op === "x")!.count, 4);
      // @ts-expect-error: test
      assert.equal(res4.find(({ op }) => op === "y")!.count, 103);
      // @ts-expect-error: test
      assert.equal(res4.find(({ op }) => op === "z")!.count, 1003);
    });

    // https://confluentinc.atlassian.net/browse/EXP-16582
    it("special case: it should correctly handle multiple inserts even if row data is the same and upsertColumns is provided", () => {
      const columns = [
        {
          name: "sid",
          type: { nullable: false, type: "VARCHAR" },
        },
        {
          name: "name",
          type: { nullable: true, type: "VARCHAR" },
        },
        {
          name: "number",
          type: { nullable: true, type: "INTEGER" },
        },
      ];
      // even though the first two rows have the same data, the expected behavior is to create two separate rows
      // with different ids, because the first row is Insert and the second row is also Insert
      const rows = [
        { op: Operation.Insert, row: ["1", "<name>", 1] },
        { op: Operation.Insert, row: ["1", "<name>", 1] },
        { op: Operation.Insert, row: ["2", "<name>", 2] },
      ];
      const resMap = parseResults({
        columns,
        isAppendOnly: false,
        map: new Map(),
        rows,
        upsertColumns: [0],
      });
      const res = Array.from(resMap, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));
      assert.equal(res.length, 3);
      assert.deepEqual(res[0], { INTERNAL_ID: "1", sid: "1", name: "<name>", number: 1 });
      // UUID is always 36 characters long, plus `1-` prefix
      // this will match the id which was composed from the previous row id plus uuid
      // for example, `1-e4e5ade9-b7d2-4f02-9b1c-23c53b1922ba`
      // this is done to avoid overwriting the previous row, which is desired behavior
      assert.equal(res[1].INTERNAL_ID.length, 38);
      assert.match(res[1].INTERNAL_ID, /^1-/);
      // @ts-expect-error: test
      assert.equal(res[1].sid, "1");
      // @ts-expect-error: test
      assert.equal(res[1].name, "<name>");
      // @ts-expect-error: test
      assert.equal(res[1].number, 1);
      assert.deepEqual(res[2], { INTERNAL_ID: "2", sid: "2", name: "<name>", number: 2 });

      // it should also reliably remove the latest row even though the ID has a UUID suffix
      const rows2 = [{ op: Operation.Delete, row: ["1", "<name>", 1] }];
      const resMap2 = parseResults({
        columns,
        isAppendOnly: false,
        map: resMap,
        rows: rows2,
        upsertColumns: [0],
      });
      const res2 = Array.from(resMap2, ([INTERNAL_ID, data]) => ({
        INTERNAL_ID,
        ...Object.fromEntries(data),
      }));
      assert.equal(res2.length, 2);
      assert.deepEqual(res2[0], { INTERNAL_ID: "1", sid: "1", name: "<name>", number: 1 });
      // the row in between should be removed
      assert.deepEqual(res2[1], { INTERNAL_ID: "2", sid: "2", name: "<name>", number: 2 });
    });
  });

  describe("generateRowId", () => {
    it("returns correct row ID for simple row data without upsert columns", () => {
      const rowData = ["1", "John Doe", 30];
      const rowId = generateRowId(rowData);
      assert.equal(rowId, "1-John Doe-30");
    });

    it("returns correct row ID for simple row data with upsert columns", () => {
      const rowData = ["1", "John Doe", 30];
      const upsertColumns = [0]; // Only use the first column for ID generation
      const rowId = generateRowId(rowData, upsertColumns);
      assert.equal(rowId, "1");
    });
  });

  describe("validateUUIDSuffix", () => {
    it("returns false for a short key", () => {
      assert.equal(validateUUIDSuffix("short-key"), false);
    });
    it("returns false for a long key (more than 36) without a UUID", () => {
      assert.equal(validateUUIDSuffix("long-key-without-uuid-12345678901234567890"), false);
    });
    it("returns false for a key with not a v4 UUID", () => {
      assert.equal(validateUUIDSuffix("key-with-uuid-2c5ea4c0-4067-11e9-9bdd-2b0d7b3dcb6d"), false); // v1 UUID
    });
    it("returns true for a key with a v4 UUID", () => {
      assert.equal(validateUUIDSuffix("1-2c5ea4c0-4067-4e9b-9bdd-2b0d7b3dcb6d"), true);
    });
  });
});
