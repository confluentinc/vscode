import * as assert from "assert";
import { SqlV1ResultSchema } from "../clients/flinkSql";
import { createColumnDefinitions, getColumnOrder } from "./flinkStatementResultColumns";

describe("flinkStatementResultColumns", () => {
  const schema: SqlV1ResultSchema = {
    columns: [
      { name: "id", type: { type: "INT", nullable: false } },
      { name: "name", type: { type: "STRING", nullable: true } },
      { name: "value", type: { type: "FLOAT", nullable: true } },
    ],
  };

  it("should create correct columns for table view", () => {
    const columns = createColumnDefinitions(schema, "table");
    assert.deepEqual(Object.keys(columns), ["id", "name", "value"]);
    assert.strictEqual(columns["id"].title(), "id");
    assert.strictEqual(columns["name"].title(), "name");
    assert.strictEqual(columns["value"].title(), "value");
  });

  it("should create correct columns for changelog view", () => {
    const columns = createColumnDefinitions(schema, "changelog");
    assert.deepEqual(Object.keys(columns), ["op", "id", "name", "value"]);
    assert.strictEqual(columns["op"].title(), "Operation");
    assert.strictEqual(columns["id"].title(), "id");
    assert.strictEqual(columns["name"].title(), "name");
    assert.strictEqual(columns["value"].title(), "value");

    // Assert exact set of column keys
    const expectedKeys = ["op", "id", "name", "value"];
    assert.deepStrictEqual(Object.keys(columns), expectedKeys);
  });

  it("should get correct column order for table view", () => {
    const order = getColumnOrder(schema, "table");
    assert.deepEqual(order, ["id", "name", "value"]);
  });

  it("should get correct column order for changelog view", () => {
    const order = getColumnOrder(schema, "changelog");
    assert.deepEqual(order, ["op", "id", "name", "value"]);
  });

  it("should handle empty schema", () => {
    const emptySchema: SqlV1ResultSchema = { columns: [] };
    assert.deepEqual(getColumnOrder(emptySchema, "table"), []);
    assert.deepEqual(getColumnOrder(emptySchema, "changelog"), ["op"]);
    assert.deepEqual(Object.keys(createColumnDefinitions(emptySchema, "table")), []);
    assert.deepEqual(Object.keys(createColumnDefinitions(emptySchema, "changelog")), ["op"]);
  });

  it("should handle undefined columns in schema", () => {
    const undefinedColumnsSchema: SqlV1ResultSchema = { columns: undefined };
    assert.deepEqual(getColumnOrder(undefinedColumnsSchema, "table"), []);
    assert.deepEqual(getColumnOrder(undefinedColumnsSchema, "changelog"), ["op"]);
    assert.deepEqual(Object.keys(createColumnDefinitions(undefinedColumnsSchema, "table")), []);
    assert.deepEqual(Object.keys(createColumnDefinitions(undefinedColumnsSchema, "changelog")), [
      "op",
    ]);
  });

  it("should correctly handle children values in table view", () => {
    const columns = createColumnDefinitions(schema, "table");
    const testData = {
      id: 1,
      name: "test",
      value: 42.5,
    };

    assert.strictEqual(columns["id"].children(testData), 1);
    assert.strictEqual(columns["name"].children(testData), "test");
    assert.strictEqual(columns["value"].children(testData), 42.5);
  });

  it("should handle null values in table view", () => {
    const columns = createColumnDefinitions(schema, "table");
    const testData = {
      id: 1,
      name: null,
      value: undefined,
    };

    assert.strictEqual(columns["id"].children(testData), 1);
    assert.strictEqual(columns["name"].children(testData), "NULL");
    assert.strictEqual(columns["value"].children(testData), "NULL");
  });

  it("should correctly handle children values in changelog view", () => {
    const columns = createColumnDefinitions(schema, "changelog");
    const testData = {
      op: 0,
      row: [1, "test", 42.5],
    };

    assert.strictEqual(columns["op"].children(testData), "+I");
    assert.strictEqual(columns["id"].children(testData), 1);
    assert.strictEqual(columns["name"].children(testData), "test");
    assert.strictEqual(columns["value"].children(testData), 42.5);
  });

  it("should handle null values in changelog view", () => {
    const columns = createColumnDefinitions(schema, "changelog");
    const testData = {
      op: 1,
      row: [1, null, undefined],
    };

    assert.strictEqual(columns["op"].children(testData), "-U");
    assert.strictEqual(columns["id"].children(testData), 1);
    assert.strictEqual(columns["name"].children(testData), "NULL");
    assert.strictEqual(columns["value"].children(testData), "NULL");
  });

  const operationTestCases = [
    { op: 0, expected: "+I", description: "insert" },
    { op: 1, expected: "-U", description: "before update" },
    { op: 2, expected: "+U", description: "after update" },
    { op: 3, expected: "-D", description: "delete" },
  ];

  operationTestCases.forEach(({ op, expected, description }) => {
    it(`should handle ${description} operation type (${op})`, () => {
      const columns = createColumnDefinitions(schema, "changelog");
      const testData = {
        op,
        row: [1, "test", 42.5],
      };

      assert.strictEqual(columns["op"].children(testData), expected);
      assert.strictEqual(columns["id"].children(testData), 1);
      assert.strictEqual(columns["name"].children(testData), "test");
      assert.strictEqual(columns["value"].children(testData), 42.5);
    });
  });

  it("should handle unknown operation type in changelog view", () => {
    const columns = createColumnDefinitions(schema, "changelog");
    const testData = {
      op: 999, // Unknown operation type
      row: [1, "test", 42.5],
    };

    assert.strictEqual(columns["op"].children(testData), 999);
    assert.strictEqual(columns["id"].children(testData), 1);
    assert.strictEqual(columns["name"].children(testData), "test");
    assert.strictEqual(columns["value"].children(testData), 42.5);
  });

  it("should handle undefined operation in changelog view", () => {
    const columns = createColumnDefinitions(schema, "changelog");
    const testData = {
      row: [1, "test", 42.5],
    };

    assert.strictEqual(columns["op"].description(testData), "NULL");
  });

  it("should handle undefined row in changelog view", () => {
    const columns = createColumnDefinitions(schema, "changelog");
    const testData = {
      op: 0,
    };

    assert.strictEqual(columns["id"].children(testData), "NULL");
    assert.strictEqual(columns["name"].children(testData), "NULL");
    assert.strictEqual(columns["value"].children(testData), "NULL");
  });

  it("should handle undefined values in table view", () => {
    const columns = createColumnDefinitions(schema, "table");
    const testData = {};

    assert.strictEqual(columns["id"].children(testData), "NULL");
    assert.strictEqual(columns["name"].children(testData), "NULL");
    assert.strictEqual(columns["value"].children(testData), "NULL");
  });

  it("should handle undefined values in table view with partial data", () => {
    const columns = createColumnDefinitions(schema, "table");
    const testData = {
      id: 1,
      // name is intentionally omitted
      value: null,
    };

    assert.strictEqual(columns["id"].children(testData), 1);
    assert.strictEqual(columns["name"].children(testData), "NULL");
    assert.strictEqual(columns["value"].children(testData), "NULL");
  });

  it("should handle description function in table view", () => {
    const columns = createColumnDefinitions(schema, "table");
    const testData = {
      id: 1,
      name: "test",
      value: 42.5,
    };

    assert.strictEqual(columns["id"].description(testData), 1);
    assert.strictEqual(columns["name"].description(testData), "test");
    assert.strictEqual(columns["value"].description(testData), 42.5);
  });

  it("should handle description function in changelog view", () => {
    const columns = createColumnDefinitions(schema, "changelog");
    const testData = {
      op: 0,
      row: [1, "test", 42.5],
    };

    assert.strictEqual(columns["op"].description(testData), 0);
    assert.strictEqual(columns["id"].description(testData), 1);
    assert.strictEqual(columns["name"].description(testData), "test");
    assert.strictEqual(columns["value"].description(testData), 42.5);
  });
});
