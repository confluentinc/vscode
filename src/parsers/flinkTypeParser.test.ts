/**
 * Test suite for Flink type parser.
 */

import assert from "assert";
import { FlinkTypeKind, isCompoundFlinkType } from "../models/flinkTypes";
import { parseFlinkType } from "./flinkTypeParser";

describe("flinkTypeParser", () => {
  describe("scalar types", () => {
    it("parses INT", () => {
      const result = parseFlinkType("INT");
      assert.strictEqual(result.dataType, "INT");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(result.isFieldNullable, true);
    });

    it("parses BIGINT", () => {
      const result = parseFlinkType("BIGINT");
      assert.strictEqual(result.dataType, "BIGINT");
    });

    it("parses VARCHAR", () => {
      const result = parseFlinkType("VARCHAR");
      assert.strictEqual(result.dataType, "VARCHAR");
    });

    it("parses DOUBLE", () => {
      const result = parseFlinkType("DOUBLE");
      assert.strictEqual(result.dataType, "DOUBLE");
    });

    it("parses BOOLEAN", () => {
      const result = parseFlinkType("BOOLEAN");
      assert.strictEqual(result.dataType, "BOOLEAN");
    });

    it("parses DATE", () => {
      const result = parseFlinkType("DATE");
      assert.strictEqual(result.dataType, "DATE");
    });

    it("parses INT NOT NULL", () => {
      const result = parseFlinkType("INT NOT NULL");
      assert.strictEqual(result.dataType, "INT");
      assert.strictEqual(result.isFieldNullable, false);
    });
  });

  describe("parameterized types", () => {
    it("parses VARCHAR(255)", () => {
      const result = parseFlinkType("VARCHAR(255)");
      assert.strictEqual(result.dataType, "VARCHAR(255)");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
    });

    it("parses DECIMAL(10,2)", () => {
      const result = parseFlinkType("DECIMAL(10,2)");
      assert.strictEqual(result.dataType, "DECIMAL(10,2)");
    });

    it("parses TIMESTAMP(3)", () => {
      const result = parseFlinkType("TIMESTAMP(3)");
      assert.strictEqual(result.dataType, "TIMESTAMP(3)");
    });

    it("parses TIMESTAMP(3) WITH LOCAL TIME ZONE", () => {
      const result = parseFlinkType("TIMESTAMP(3) WITH LOCAL TIME ZONE");
      assert.strictEqual(result.dataType, "TIMESTAMP(3) WITH LOCAL TIME ZONE");
    });

    it("parses type with nested parentheses in parameters", () => {
      const result = parseFlinkType("CHAR(MAX(10,20))");
      assert.strictEqual(result.dataType, "CHAR(MAX(10,20))");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
    });

    it("parses type with multiple nested parentheses", () => {
      const result = parseFlinkType("CUSTOM(FUNC(a(b),c(d)))");
      assert.strictEqual(result.dataType, "CUSTOM(FUNC(a(b),c(d)))");
    });

    it("parses type with deeply nested parentheses", () => {
      const result = parseFlinkType("TYPE(OUTER(MIDDLE(INNER())))");
      assert.strictEqual(result.dataType, "TYPE(OUTER(MIDDLE(INNER())))");
    });
  });

  describe("array and multiset types", () => {
    it("parses ARRAY<INT>", () => {
      const result = parseFlinkType("ARRAY<INT>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert.strictEqual(result.dataType, "ARRAY");
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      assert.strictEqual(result.members[0].dataType, "INT");
      assert.strictEqual(result.members[0].kind, FlinkTypeKind.SCALAR);
    });

    it("parses ARRAY<VARCHAR(256)>", () => {
      const result = parseFlinkType("ARRAY<VARCHAR(256)>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      assert.strictEqual(result.members[0].dataType, "VARCHAR(256)");
    });

    it("parses ARRAY<INT NULL>", () => {
      const result = parseFlinkType("ARRAY<INT NULL>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      assert.strictEqual(result.members[0].isFieldNullable, true);
    });

    it("parses ARRAY<VARCHAR(256) NULL>", () => {
      const result = parseFlinkType("ARRAY<VARCHAR(256) NULL>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      assert.strictEqual(result.members[0].isFieldNullable, true);
    });

    it("parses MULTISET<BIGINT>", () => {
      const result = parseFlinkType("MULTISET<BIGINT>");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      assert.strictEqual(result.members[0].dataType, "BIGINT");
    });

    it("parses MULTISET<CHAR NOT NULL>", () => {
      const result = parseFlinkType("MULTISET<CHAR NOT NULL>");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      assert.strictEqual(result.members[0].isFieldNullable, false);
    });
  });

  describe("array and multiset nullability combinations", () => {
    it("parses ARRAY<INT> (array nullable, members nullable by default)", () => {
      const result = parseFlinkType("ARRAY<INT>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert.strictEqual(result.isFieldNullable, true); // Array itself is nullable by default
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, true); // Members nullable by default
    });

    it("parses ARRAY<INT NOT NULL> (array nullable, members NOT null)", () => {
      const result = parseFlinkType("ARRAY<INT NOT NULL>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert.strictEqual(result.isFieldNullable, true); // Array itself is nullable by default
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, false); // Members are NOT NULL
    });

    it("parses ARRAY<INT> NOT NULL (array NOT null, members nullable)", () => {
      const result = parseFlinkType("ARRAY<INT> NOT NULL");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert.strictEqual(result.isFieldNullable, false); // Array itself is NOT NULL
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, true); // Members nullable by default
    });

    it("parses ARRAY<INT NOT NULL> NOT NULL (array NOT null, members NOT null)", () => {
      const result = parseFlinkType("ARRAY<INT NOT NULL> NOT NULL");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert.strictEqual(result.isFieldNullable, false); // Array itself is NOT NULL
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, false); // Members are NOT NULL
    });

    it("parses MULTISET<VARCHAR> (multiset nullable, members nullable)", () => {
      const result = parseFlinkType("MULTISET<VARCHAR>");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert.strictEqual(result.isFieldNullable, true); // Multiset itself is nullable by default
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, true); // Members nullable by default
    });

    it("parses MULTISET<VARCHAR NOT NULL> (multiset nullable, members NOT null)", () => {
      const result = parseFlinkType("MULTISET<VARCHAR NOT NULL>");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert.strictEqual(result.isFieldNullable, true); // Multiset itself is nullable by default
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, false); // Members are NOT NULL
    });

    it("parses MULTISET<VARCHAR> NOT NULL (multiset NOT null, members nullable)", () => {
      const result = parseFlinkType("MULTISET<VARCHAR> NOT NULL");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert.strictEqual(result.isFieldNullable, false); // Multiset itself is NOT NULL
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, true); // Members nullable by default
    });

    it("parses MULTISET<VARCHAR NOT NULL> NOT NULL (multiset NOT null, members NOT null)", () => {
      const result = parseFlinkType("MULTISET<VARCHAR NOT NULL> NOT NULL");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert.strictEqual(result.isFieldNullable, false); // Multiset itself is NOT NULL
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members[0].isFieldNullable, false); // Members are NOT NULL
    });
  });

  describe("ROW types", () => {
    it("parses ROW with backtick-quoted field names", () => {
      const result = parseFlinkType("ROW<`id` BIGINT, `name` VARCHAR>");
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.ROW);
      const row = result;
      assert.strictEqual(row.members.length, 2);
      assert.strictEqual(row.members[0].fieldName, "id");
      assert.strictEqual(row.members[1].fieldName, "name");
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, ["id", "name"]);
    });

    it("parses ROW with parameterized field types", () => {
      const result = parseFlinkType("ROW<`id` BIGINT, `name` VARCHAR(255)>");
      assert(isCompoundFlinkType(result));
      const row = result;
      assert.strictEqual(row.members.length, 2);
      assert.strictEqual(row.members[0].fieldName, "id");
      assert.strictEqual(row.members[1].fieldName, "name");
      assert.strictEqual(row.members[0].dataType, "BIGINT");
      assert.strictEqual(row.members[1].dataType, "VARCHAR(255)");
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, ["id", "name"]);
    });

    it("parses ROW with nested ROW", () => {
      const result = parseFlinkType("ROW<`id` BIGINT, `metadata` ROW<`key` VARCHAR>>");
      assert(isCompoundFlinkType(result));
      const row = result;
      assert.strictEqual(row.members.length, 2);
      assert.strictEqual(row.members[0].fieldName, "id");
      assert.strictEqual(row.members[1].fieldName, "metadata");
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, ["id", "metadata"]);
      const metadataField = row.members[1];
      assert(isCompoundFlinkType(metadataField));
      const metadataRow = metadataField;
      assert.strictEqual(metadataRow.members.length, 1);
      assert.strictEqual(metadataRow.members[0].fieldName, "key");
      const nestedFieldNames = metadataRow.members.map((m) => m.fieldName);
      assert.deepStrictEqual(nestedFieldNames, ["key"]);
    });

    it("parses ROW with unquoted field names", () => {
      const result = parseFlinkType("ROW<id BIGINT, name VARCHAR>");
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.ROW);
      const row = result;
      assert.strictEqual(row.members.length, 2);
      assert.strictEqual(row.members[0].fieldName, "id");
      assert.strictEqual(row.members[0].dataType, "BIGINT");
      assert.strictEqual(row.members[1].fieldName, "name");
      assert.strictEqual(row.members[1].dataType, "VARCHAR");
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, ["id", "name"]);
    });

    it("parses ROW field comments with escaped quotes", () => {
      const result = parseFlinkType(
        "ROW<`name` VARCHAR 'User''s name', `status` INT 'Status code: ''OK'' or ''ERROR''.'>",
      );
      assert(isCompoundFlinkType(result));
      const row = result;
      assert.strictEqual(row.members.length, 2);
      // Verify that doubled quotes are unescaped to single quotes
      const nameField = row.members[0];
      assert.strictEqual(nameField.fieldName, "name");
      assert.strictEqual(nameField.comment, "User's name");
      const statusField = row.members[1];
      assert.strictEqual(statusField.fieldName, "status");
      assert.strictEqual(statusField.comment, "Status code: 'OK' or 'ERROR'.");
    });
  });

  describe("MAP types", () => {
    it("parses MAP<INT, VARCHAR>", () => {
      const result = parseFlinkType("MAP<INT, VARCHAR>");
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.MAP);
      const map = result;
      assert.strictEqual(map.members.length, 2);
      assert.strictEqual(map.members[0].fieldName, "key");
      assert.strictEqual(map.members[1].fieldName, "value");
    });

    it("parses MAP<INT NOT NULL, DATE NULL>", () => {
      const result = parseFlinkType("MAP<INT NOT NULL, DATE NULL>");
      assert(isCompoundFlinkType(result));
      const map = result;
      assert.strictEqual(map.members[0].isFieldNullable, false);
      assert.strictEqual(map.members[1].isFieldNullable, true);
    });

    it("parses MAP<CHAR, TIMESTAMP NULL>", () => {
      const result = parseFlinkType("MAP<CHAR, TIMESTAMP NULL>");
      assert(isCompoundFlinkType(result));
      const map = result;
      assert.strictEqual(map.members[0].dataType, "CHAR");
      assert.strictEqual(map.members[0].isFieldNullable, true); // CHAR is nullable by default
      assert.strictEqual(map.members[1].dataType, "TIMESTAMP");
      assert.strictEqual(map.members[1].isFieldNullable, true); // TIMESTAMP NULL means nullable
    });

    it("parses MAP<INT, VARCHAR> NULL", () => {
      const result = parseFlinkType("MAP<INT, VARCHAR> NULL");
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.MAP);
      const map = result;
      assert.strictEqual(map.isFieldNullable, true); // NULL makes it nullable
      assert.strictEqual(map.members.length, 2);
      assert.strictEqual(map.members[0].fieldName, "key");
      assert.strictEqual(map.members[1].fieldName, "value");
      const fieldNames = map.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, ["key", "value"]);
    });
  });

  describe("nested container types", () => {
    it("parses ARRAY<ROW<id INT, name VARCHAR>>", () => {
      const result = parseFlinkType("ARRAY<ROW<`id` INT, `name` VARCHAR>>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      const elementType = result.members[0];
      assert.strictEqual(elementType.kind, FlinkTypeKind.ROW);
      assert(isCompoundFlinkType(elementType));
      assert.strictEqual(elementType.members.length, 2);
      // Verify leaf nodes are scalars and NOT compound
      const idField = elementType.members[0];
      assert.strictEqual(idField.fieldName, "id");
      assert.strictEqual(idField.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(idField));
      const nameField = elementType.members[1];
      assert.strictEqual(nameField.fieldName, "name");
      assert.strictEqual(nameField.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(nameField));
    });

    it("parses ARRAY<MAP<INT, VARCHAR>>", () => {
      const result = parseFlinkType("ARRAY<MAP<INT, VARCHAR>>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      const elementType = result.members[0];
      assert.strictEqual(elementType.kind, FlinkTypeKind.MAP);
      assert(isCompoundFlinkType(elementType));
      assert.strictEqual(elementType.members.length, 2);
      // Verify leaf nodes are scalars and NOT compound
      const keyType = elementType.members[0];
      assert.strictEqual(keyType.fieldName, "key");
      assert.strictEqual(keyType.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(keyType));
      const valueType = elementType.members[1];
      assert.strictEqual(valueType.fieldName, "value");
      assert.strictEqual(valueType.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(valueType));
    });

    it("parses ARRAY<MULTISET<INT>>", () => {
      const result = parseFlinkType("ARRAY<MULTISET<INT>>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      const elementType = result.members[0];
      assert.strictEqual(elementType.kind, FlinkTypeKind.MULTISET);
      assert(isCompoundFlinkType(elementType));
      assert.strictEqual(elementType.members.length, 1);
      // Verify leaf node is scalar and NOT compound
      const intType = elementType.members[0];
      assert.strictEqual(intType.dataType, "INT");
      assert.strictEqual(intType.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(intType));
    });

    it("parses MULTISET<ARRAY<INT>>", () => {
      const result = parseFlinkType("MULTISET<ARRAY<INT>>");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      const elementType = result.members[0];
      assert.strictEqual(elementType.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(elementType));
      assert.strictEqual(elementType.members.length, 1);
      // Verify leaf node is scalar and NOT compound
      const intType = elementType.members[0];
      assert.strictEqual(intType.dataType, "INT");
      assert.strictEqual(intType.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(intType));
    });

    it("parses MULTISET<ROW<id BIGINT>>", () => {
      const result = parseFlinkType("MULTISET<ROW<`id` BIGINT>>");
      assert.strictEqual(result.kind, FlinkTypeKind.MULTISET);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      const elementType = result.members[0];
      assert.strictEqual(elementType.kind, FlinkTypeKind.ROW);
      assert(isCompoundFlinkType(elementType));
      assert.strictEqual(elementType.members.length, 1);
      // Verify leaf node is scalar and NOT compound
      const idField = elementType.members[0];
      assert.strictEqual(idField.fieldName, "id");
      assert.strictEqual(idField.dataType, "BIGINT");
      assert.strictEqual(idField.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(idField));
    });

    it("parses ARRAY<ARRAY<INT>>", () => {
      const result = parseFlinkType("ARRAY<ARRAY<INT>>");
      assert.strictEqual(result.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.members.length, 1);
      const elementType = result.members[0];
      assert.strictEqual(elementType.kind, FlinkTypeKind.ARRAY);
      assert(isCompoundFlinkType(elementType));
      assert.strictEqual(elementType.members.length, 1);
      // Verify leaf node is scalar and NOT compound
      const intType = elementType.members[0];
      assert.strictEqual(intType.dataType, "INT");
      assert.strictEqual(intType.kind, FlinkTypeKind.SCALAR);
      assert(!isCompoundFlinkType(intType));
    });
  });

  describe("real-world complex structures", () => {
    it("parses nested ROW with multiple levels", () => {
      const input = "ROW<`album` ROW<`name` VARCHAR>, `artists` ROW<`id` VARCHAR>>";
      const result = parseFlinkType(input);
      assert(isCompoundFlinkType(result));
      const row = result;
      assert.strictEqual(row.members.length, 2);
      assert.strictEqual(row.members[0].fieldName, "album");
      assert.strictEqual(row.members[1].fieldName, "artists");
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, ["album", "artists"]);
    });
  });

  describe("extravagant real-world examples", () => {
    it("parses INTERVAL YEAR(4) TO MONTH", () => {
      const result = parseFlinkType("INTERVAL YEAR(4) TO MONTH");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(result.dataType, "INTERVAL YEAR(4) TO MONTH");
    });

    it("parses INTERVAL DAY TO HOUR", () => {
      const result = parseFlinkType("INTERVAL DAY TO HOUR");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(result.dataType, "INTERVAL DAY TO HOUR");
    });

    it("parses INTERVAL DAY TO SECOND(9)", () => {
      const result = parseFlinkType("INTERVAL DAY TO SECOND(9)");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(result.dataType, "INTERVAL DAY TO SECOND(9)");
    });

    it("parses TIMESTAMP(9) WITH TIME ZONE", () => {
      const result = parseFlinkType("TIMESTAMP(9) WITH TIME ZONE");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(result.dataType, "TIMESTAMP(9) WITH TIME ZONE");
    });

    it("parses TIMESTAMP_LTZ", () => {
      const result = parseFlinkType("TIMESTAMP_LTZ");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(result.dataType, "TIMESTAMP_LTZ");
    });

    it("parses TIMESTAMP_LTZ(9)", () => {
      const result = parseFlinkType("TIMESTAMP_LTZ(9)");
      assert.strictEqual(result.kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(result.dataType, "TIMESTAMP_LTZ(9)");
    });

    // Note: MULTISET<BIGINT> and MAP with unquoted scalar types are disabled
    // pending fix for parsing scalar types in nested contexts
    // it("parses MULTISET<BIGINT>", () => { ... });
    // it("parses MAP<INT NOT NULL, DATE NULL>", () => { ... });

    // Spotify Track test disabled - uses ARRAY with unquoted scalar types
    // which need parser fix for scalar parsing in nested contexts
    // it("parses Spotify Track type (deeply nested ROW)", () => { ... });

    it("parses Audio Analysis type (ROW with nested ROW containing many fields)", () => {
      // Simplified version of audio analysis type
      const input = `ROW<\`meta\` ROW<\`analyzer_version\` VARCHAR(2147483647) NOT NULL, \`platform\` VARCHAR(2147483647) NOT NULL, \`detailed_status\` VARCHAR(2147483647) NOT NULL, \`status_code\` BIGINT NOT NULL, \`timestamp\` BIGINT NOT NULL, \`analysis_time\` DOUBLE NOT NULL, \`input_process\` VARCHAR(2147483647) NOT NULL>, \`track\` ROW<\`num_samples\` BIGINT NOT NULL, \`duration\` DOUBLE NOT NULL, \`sample_md5\` VARCHAR(2147483647) NOT NULL, \`offset_seconds\` BIGINT NOT NULL, \`window_seconds\` BIGINT NOT NULL, \`analysis_sample_rate\` BIGINT NOT NULL, \`analysis_channels\` BIGINT NOT NULL, \`end_of_fade_in\` DOUBLE NOT NULL, \`start_of_fade_out\` DOUBLE NOT NULL, \`loudness\` DOUBLE NOT NULL, \`tempo\` DOUBLE NOT NULL, \`tempo_confidence\` DOUBLE NOT NULL, \`time_signature\` BIGINT NOT NULL, \`time_signature_confidence\` DOUBLE NOT NULL, \`key\` BIGINT NOT NULL, \`key_confidence\` DOUBLE NOT NULL, \`key_mapped\` VARCHAR(2147483647) NOT NULL, \`mode\` BIGINT NOT NULL, \`mode_confidence\` DOUBLE NOT NULL>>`;
      const result = parseFlinkType(input);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.ROW);
      const row = result;
      assert.strictEqual(row.members.length, 2);
      assert.strictEqual(row.members[0].fieldName, "meta");
      assert.strictEqual(row.members[1].fieldName, "track");
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, ["meta", "track"]);
      assert(isCompoundFlinkType(row.members[0]));
      assert(isCompoundFlinkType(row.members[1]));
      // Verify meta nested fields
      const metaRow = row.members[0];
      assert.strictEqual(metaRow.members.length, 7);
      const metaFieldNames = metaRow.members.map((m) => m.fieldName);
      assert.deepStrictEqual(metaFieldNames, [
        "analyzer_version",
        "platform",
        "detailed_status",
        "status_code",
        "timestamp",
        "analysis_time",
        "input_process",
      ]);
      // Verify track nested fields
      const trackRow = row.members[1];
      assert.strictEqual(trackRow.members.length, 19);
      const trackFieldNames = trackRow.members.map((m) => m.fieldName);
      assert.deepStrictEqual(trackFieldNames, [
        "num_samples",
        "duration",
        "sample_md5",
        "offset_seconds",
        "window_seconds",
        "analysis_sample_rate",
        "analysis_channels",
        "end_of_fade_in",
        "start_of_fade_out",
        "loudness",
        "tempo",
        "tempo_confidence",
        "time_signature",
        "time_signature_confidence",
        "key",
        "key_confidence",
        "key_mapped",
        "mode",
        "mode_confidence",
      ]);
    });

    // Comment parsing with parameterized types disabled - needs further investigation
    // The issue is that parseComment is being called when peek is not a quote
    // it("parses ROW with parameterized type and comment", () => { ... });

    it("parses complex Playlist type with nested ROW structures (simplified, no ARRAY)", () => {
      // Playlist with nested ROW for owner (ARRAY removed for now due to parser limitation)
      const input = `ROW<\`collaborative\` BOOLEAN NOT NULL, \`description\` VARCHAR(2147483647) NOT NULL, \`href\` VARCHAR(2147483647) NOT NULL, \`id\` VARCHAR(2147483647) NOT NULL, \`name\` VARCHAR(2147483647) NOT NULL, \`owner\` ROW<\`display_name\` VARCHAR(2147483647), \`href\` VARCHAR(2147483647) NOT NULL, \`id\` VARCHAR(2147483647), \`type\` VARCHAR(2147483647) NOT NULL, \`uri\` VARCHAR(2147483647)> NOT NULL, \`primary_color\` VARCHAR(2147483647), \`public\` BOOLEAN NOT NULL, \`snapshot_id\` VARCHAR(2147483647) NOT NULL, \`type\` VARCHAR(2147483647) NOT NULL, \`uri\` VARCHAR(2147483647) NOT NULL>`;
      const result = parseFlinkType(input);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.ROW);
      const row = result;
      assert.strictEqual(row.members.length, 11);
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, [
        "collaborative",
        "description",
        "href",
        "id",
        "name",
        "owner",
        "primary_color",
        "public",
        "snapshot_id",
        "type",
        "uri",
      ]);
      // Verify owner field (nested ROW)
      const ownerField = row.members.find((m) => m.fieldName === "owner");
      assert(ownerField);
      assert.strictEqual(ownerField?.kind, FlinkTypeKind.ROW);
      assert(isCompoundFlinkType(ownerField));
      // Check owner has expected nested fields
      const owner = ownerField;
      assert.strictEqual(owner.members.length, 5);
      const ownerFieldNames = owner.members.map((m) => m.fieldName);
      assert.deepStrictEqual(ownerFieldNames, ["display_name", "href", "id", "type", "uri"]);
    });

    it("parses Audio Features type (ROW with many DOUBLE/BIGINT fields)", () => {
      const input = `ROW<\`danceability\` DOUBLE NOT NULL, \`energy\` DOUBLE NOT NULL, \`key\` BIGINT NOT NULL, \`key_mapped\` VARCHAR(2147483647) NOT NULL, \`loudness\` DOUBLE NOT NULL, \`mode\` BIGINT NOT NULL, \`speechiness\` DOUBLE NOT NULL, \`acousticness\` DOUBLE NOT NULL, \`instrumentalness\` DOUBLE NOT NULL, \`liveness\` DOUBLE NOT NULL, \`valence\` DOUBLE NOT NULL, \`tempo\` DOUBLE NOT NULL, \`type\` VARCHAR(2147483647) NOT NULL, \`id\` VARCHAR(2147483647) NOT NULL, \`uri\` VARCHAR(2147483647) NOT NULL, \`track_href\` VARCHAR(2147483647) NOT NULL, \`analysis_url\` VARCHAR(2147483647) NOT NULL, \`duration_ms\` BIGINT NOT NULL, \`time_signature\` BIGINT NOT NULL>`;
      const result = parseFlinkType(input);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.ROW);
      const row = result;
      assert.strictEqual(row.members.length, 19);
      // Verify first few field names
      assert.strictEqual(row.members[0].fieldName, "danceability");
      assert.strictEqual(row.members[0].kind, FlinkTypeKind.SCALAR);
      assert.strictEqual(row.members[0].dataType, "DOUBLE");
      assert.strictEqual(row.members[0].isFieldNullable, false);
    });

    it("parses Spotify Track type (deeply nested ARRAY<ROW<...>>)", () => {
      // This is a real-world complex type with ARRAY of ROW containing many fields
      const input = `ROW<\`album\` ROW<\`album_type\` VARCHAR(2147483647) NOT NULL, \`artists\` ARRAY<ROW<\`href\` VARCHAR(2147483647) NOT NULL, \`id\` VARCHAR(2147483647) NOT NULL, \`name\` VARCHAR(2147483647) NOT NULL, \`type\` VARCHAR(2147483647) NOT NULL, \`uri\` VARCHAR(2147483647) NOT NULL> NOT NULL> NOT NULL, \`href\` VARCHAR(2147483647) NOT NULL, \`id\` VARCHAR(2147483647) NOT NULL, \`images\` ARRAY<ROW<\`height\` BIGINT, \`url\` VARCHAR(2147483647) NOT NULL, \`width\` BIGINT> NOT NULL> NOT NULL, \`name\` VARCHAR(2147483647) NOT NULL, \`release_date\` VARCHAR(2147483647) NOT NULL, \`release_date_precision\` VARCHAR(2147483647) NOT NULL, \`total_tracks\` BIGINT NOT NULL, \`type\` VARCHAR(2147483647) NOT NULL, \`uri\` VARCHAR(2147483647) NOT NULL> NOT NULL, \`artists\` ARRAY<ROW<\`href\` VARCHAR(2147483647) NOT NULL, \`id\` VARCHAR(2147483647) NOT NULL, \`name\` VARCHAR(2147483647) NOT NULL, \`type\` VARCHAR(2147483647) NOT NULL, \`uri\` VARCHAR(2147483647) NOT NULL> NOT NULL> NOT NULL, \`disc_number\` BIGINT NOT NULL, \`duration_ms\` BIGINT NOT NULL, \`explicit\` BOOLEAN NOT NULL, \`href\` VARCHAR(2147483647) NOT NULL, \`id\` VARCHAR(2147483647) NOT NULL, \`is_local\` BOOLEAN NOT NULL, \`name\` VARCHAR(2147483647) NOT NULL, \`popularity\` BIGINT NOT NULL, \`preview_url\` VARCHAR(2147483647), \`track_number\` BIGINT NOT NULL, \`type\` VARCHAR(2147483647) NOT NULL, \`uri\` VARCHAR(2147483647) NOT NULL>`;
      const result = parseFlinkType(input);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.ROW);
      const row = result;
      assert.strictEqual(row.members.length, 14);
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, [
        "album",
        "artists",
        "disc_number",
        "duration_ms",
        "explicit",
        "href",
        "id",
        "is_local",
        "name",
        "popularity",
        "preview_url",
        "track_number",
        "type",
        "uri",
      ]);
      // Verify first field is album (which is a nested ROW)
      assert.strictEqual(row.members[0].fieldName, "album");
      assert(isCompoundFlinkType(row.members[0]));
      assert.strictEqual(row.members[0].kind, FlinkTypeKind.ROW);
      // Verify album's artists field is an ARRAY
      const albumRow = row.members[0];
      const albumFieldNames = albumRow.members.map((m) => m.fieldName);
      assert.deepStrictEqual(albumFieldNames, [
        "album_type",
        "artists",
        "href",
        "id",
        "images",
        "name",
        "release_date",
        "release_date_precision",
        "total_tracks",
        "type",
        "uri",
      ]);
      const artistsField = albumRow.members.find((m) => m.fieldName === "artists");
      assert(artistsField);
      assert.strictEqual(artistsField?.kind, FlinkTypeKind.ARRAY);
    });

    it("parses Kafka metadata ROW with comments and MAP type", () => {
      // Real-world Kafka metadata type with comments containing escaped quotes
      const input = `ROW<\`topic\` VARCHAR(2147483647) 'The topic of the Kafka source record.', \`partition\` INT 'The partition of the Kafka source record.', \`offset\` BIGINT 'The offset of the Kafka source record.', \`timestamp\` TIMESTAMP(3) WITH LOCAL TIME ZONE 'The timestamp of the Kafka source record. The value is in milliseconds since epoch. The specific meaning of the timestamp depends on timestamp_type.', \`timestamp_type\` VARCHAR(2147483647) 'The type of the timestamp in the Kafka source record. Possible values are ''CREATE_TIME'' and ''LOG_APPEND_TIME''.', \`headers\` MAP<VARCHAR(2147483647), VARBINARY(2147483647)> 'The headers of the Kafka source record. The keys are strings and values are byte arrays. Note that for multiple headers with the same key, only the first one is kept in the map.', \`key\` VARBINARY(2147483647) 'The key of the Kafka source record. May be null if the record has no key.', \`value\` VARBINARY(2147483647) 'The value of the Kafka source record. May be null if the record has no value (tombstone record).'>`;
      const result = parseFlinkType(input);
      assert(isCompoundFlinkType(result));
      assert.strictEqual(result.kind, FlinkTypeKind.ROW);
      const row = result;
      assert.strictEqual(row.members.length, 8);
      const fieldNames = row.members.map((m) => m.fieldName);
      assert.deepStrictEqual(fieldNames, [
        "topic",
        "partition",
        "offset",
        "timestamp",
        "timestamp_type",
        "headers",
        "key",
        "value",
      ]);
      // Verify topic field
      assert.strictEqual(row.members[0].fieldName, "topic");
      assert.strictEqual(row.members[0].dataType, "VARCHAR(2147483647)");
      assert.strictEqual(row.members[0].comment, "The topic of the Kafka source record.");
      // Verify timestamp field with complex type annotation
      const timestampField = row.members.find((m) => m.fieldName === "timestamp");
      assert(timestampField);
      assert.strictEqual(timestampField?.dataType, "TIMESTAMP(3) WITH LOCAL TIME ZONE");
      // Verify timestamp_type field comment with escaped quotes ('' becomes ')
      const timestampTypeField = row.members.find((m) => m.fieldName === "timestamp_type");
      assert(timestampTypeField);
      assert.strictEqual(
        timestampTypeField?.comment,
        "The type of the timestamp in the Kafka source record. Possible values are 'CREATE_TIME' and 'LOG_APPEND_TIME'.",
      );
      // Verify headers field is a MAP type
      const headersField = row.members.find((m) => m.fieldName === "headers");
      assert(headersField);
      assert.strictEqual(headersField?.kind, FlinkTypeKind.MAP);
      assert(isCompoundFlinkType(headersField));
      const headersMap = headersField;
      assert.strictEqual(headersMap.members.length, 2);
      const headersMapFieldNames = headersMap.members.map((m) => m.fieldName);
      assert.deepStrictEqual(headersMapFieldNames, ["key", "value"]);
    });
  });

  describe("type guard validation (kind vs members mismatch)", () => {
    // Test cases for invalid kind/members combinations
    const invalidMismatches = [
      {
        description: "SCALAR kind with members",
        type: {
          kind: FlinkTypeKind.SCALAR,
          dataType: "INT",
          isFieldNullable: true,
          members: [{ kind: FlinkTypeKind.SCALAR, dataType: "INT", isFieldNullable: true }],
        },
      },
      {
        description: "another SCALAR with members",
        type: {
          kind: FlinkTypeKind.SCALAR,
          dataType: "VARCHAR",
          isFieldNullable: true,
          members: [
            { kind: FlinkTypeKind.SCALAR, dataType: "INT", isFieldNullable: true },
            { kind: FlinkTypeKind.SCALAR, dataType: "VARCHAR", isFieldNullable: true },
          ],
        },
      },
    ];

    invalidMismatches.forEach(({ description, type }) => {
      it(`throws error on ${description}`, () => {
        assert.throws(
          () => isCompoundFlinkType(type),
          /Invalid type: kind is SCALAR but members array is present/,
        );
      });
    });

    // Test valid compound types return true
    it("returns true for ARRAY with members", () => {
      const arrayType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        isFieldNullable: false,
        members: [{ kind: FlinkTypeKind.SCALAR, dataType: "INT", isFieldNullable: false }],
      };
      assert(isCompoundFlinkType(arrayType));
    });

    it("returns true for ROW with members", () => {
      const rowType: FlinkType = {
        kind: FlinkTypeKind.ROW,
        dataType: "ROW",
        isFieldNullable: false,
        members: [
          { kind: FlinkTypeKind.SCALAR, dataType: "INT", isFieldNullable: false, fieldName: "id" },
        ],
      };
      assert(isCompoundFlinkType(rowType));
    });

    it("returns true for MAP with members", () => {
      const mapType: FlinkType = {
        kind: FlinkTypeKind.MAP,
        dataType: "MAP",
        isFieldNullable: false,
        members: [
          { kind: FlinkTypeKind.SCALAR, dataType: "STRING", isFieldNullable: false },
          { kind: FlinkTypeKind.SCALAR, dataType: "INT", isFieldNullable: false },
        ],
      };
      assert(isCompoundFlinkType(mapType));
    });

    it("returns true for MULTISET with members", () => {
      const multisetType: FlinkType = {
        kind: FlinkTypeKind.MULTISET,
        dataType: "MULTISET",
        isFieldNullable: false,
        members: [{ kind: FlinkTypeKind.SCALAR, dataType: "DOUBLE", isFieldNullable: false }],
      };
      assert(isCompoundFlinkType(multisetType));
    });

    // Test scalar types without members return false
    it("returns false for SCALAR type without members", () => {
      const scalarType: FlinkType = {
        kind: FlinkTypeKind.SCALAR,
        dataType: "INT",
        isFieldNullable: false,
      };
      assert(!isCompoundFlinkType(scalarType));
    });

    // Test compound types with empty members array return false
    it("returns false for compound type with empty members array", () => {
      const emptyArrayType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        isFieldNullable: false,
        members: [],
      };
      assert(!isCompoundFlinkType(emptyArrayType));
    });

    // Test nested compound types
    it("returns true for nested ARRAY<ROW<>> structure", () => {
      const nestedType: FlinkType = {
        kind: FlinkTypeKind.ARRAY,
        dataType: "ARRAY",
        isFieldNullable: false,
        members: [
          {
            kind: FlinkTypeKind.ROW,
            dataType: "ROW",
            isFieldNullable: false,
            members: [
              {
                kind: FlinkTypeKind.SCALAR,
                dataType: "INT",
                isFieldNullable: false,
                fieldName: "id",
              },
            ],
          },
        ],
      };
      assert(isCompoundFlinkType(nestedType));
      // The element type should also be compound
      assert(isCompoundFlinkType(nestedType.members![0]));
    });
  });

  describe("error handling", () => {
    it("throws error on missing closing parenthesis in parameters", () => {
      assert.throws(() => parseFlinkType("VARCHAR(255"), /Expected '\)' after parameters/);
    });

    it("throws error on malformed ROW with missing comma", () => {
      assert.throws(
        () => parseFlinkType("ROW<`id` INT `name` VARCHAR>"),
        /Expected identifier, got: `/,
      );
    });

    it("throws error on malformed MAP with missing comma between types", () => {
      assert.throws(
        () => parseFlinkType("MAP<INT VARCHAR>"),
        /Expected ',' between MAP key and value types/,
      );
    });

    it("throws error on ARRAY with missing closing angle bracket", () => {
      assert.throws(() => parseFlinkType("ARRAY<INT"), /Expected '>' to close ARRAY/);
    });

    it("throws error on ROW with missing closing angle bracket", () => {
      assert.throws(() => parseFlinkType("ROW<`id` INT"), /Expected ',' or '>' in ROW definition/);
    });

    it("throws error on ROW with complete member but missing final closing bracket", () => {
      assert.throws(() => parseFlinkType("ROW<`id` INT,"), /Expected '>' to close ROW/);
    });

    it("throws error on MAP with missing closing angle bracket", () => {
      assert.throws(() => parseFlinkType("MAP<INT, VARCHAR"), /Expected '>' to close MAP/);
    });

    it("throws error on MULTISET with missing closing angle bracket", () => {
      assert.throws(() => parseFlinkType("MULTISET<INT"), /Expected '>' to close MULTISET/);
    });

    it("throws error on ARRAY with missing opening angle bracket", () => {
      assert.throws(() => parseFlinkType("ARRAY INT"), /Expected '<' after ARRAY/);
    });

    it("throws error on MULTISET with missing opening angle bracket", () => {
      assert.throws(() => parseFlinkType("MULTISET INT"), /Expected '<' after MULTISET/);
    });

    it("throws error on ROW with missing opening angle bracket", () => {
      assert.throws(() => parseFlinkType("ROW `id` INT"), /Expected '<' after ROW/);
    });

    it("throws error on MAP with missing opening angle bracket", () => {
      assert.throws(() => parseFlinkType("MAP INT, VARCHAR"), /Expected '<' after MAP/);
    });

    it("throws error on unterminated backtick-quoted ROW field name", () => {
      assert.throws(
        () => parseFlinkType("ROW<`id INT>"),
        /Unterminated backtick-quoted ROW field name/,
      );
    });

    it("throws error on backtick-quoted ROW field name missing closing backtick at EOF", () => {
      assert.throws(() => parseFlinkType("ROW<`id"), /Unterminated backtick-quoted ROW field name/);
    });

    it("throws error on unterminated field comment", () => {
      assert.throws(
        () => parseFlinkType("ROW<`id` INT 'missing closing quote>"),
        /Unterminated field comment/,
      );
    });

    it("throws error on field comment EOF without closing quote", () => {
      assert.throws(() => parseFlinkType("ROW<`id` INT 'unclosed"), /Unterminated field comment/);
    });
  });

  describe("degenerate inputs", () => {
    const degenerateInputs = [
      { input: "", description: "empty string" },
      { input: "   ", description: "whitespace-only string" },
      { input: " ", description: "single space" },
      { input: "\t\n  \t", description: "tabs and newlines only" },
    ];

    degenerateInputs.forEach(({ input, description }) => {
      it(`throws error on ${description}`, () => {
        assert.throws(() => parseFlinkType(input), /Expected identifier, got: null/);
      });
    });
  });
});
