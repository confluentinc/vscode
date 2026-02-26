import * as assert from "assert";
import { parseFlinkType } from "./flinkTypeParser";

describe("flinkTypeParser", () => {
  describe("atomic types", () => {
    describe("BIGINT", () => {
      it("parses simple BIGINT", () => {
        const result = parseFlinkType("BIGINT");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isNullable, true);
        assert.strictEqual(result.isArray, false);
        assert.strictEqual(result.arrayMembersAreNullable, false);
        assert.strictEqual(result.isMultiset, false);
        assert.strictEqual(result.multisetMembersAreNullable, false);
        assert.strictEqual(result.rowFieldName, undefined);
        assert.strictEqual(result.comment, undefined);
      });

      it("parses BIGINT with NOT NULL", () => {
        const result = parseFlinkType("BIGINT NOT NULL");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isNullable, false);
        assert.strictEqual(result.isArray, false);
        assert.strictEqual(result.arrayMembersAreNullable, false);
        assert.strictEqual(result.isMultiset, false);
        assert.strictEqual(result.multisetMembersAreNullable, false);
      });

      it("parses BIGINT with leading/trailing whitespace", () => {
        const result = parseFlinkType("  BIGINT  ");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isNullable, true);
      });

      it("parses BIGINT case-insensitive", () => {
        const result1 = parseFlinkType("bigint");
        const result2 = parseFlinkType("BigInt");

        assert.strictEqual(result1.typeName, "BIGINT");
        assert.strictEqual(result2.typeName, "BIGINT");
      });
    });

    describe("INTEGER", () => {
      it("parses simple INTEGER", () => {
        const result = parseFlinkType("INTEGER");

        assert.strictEqual(result.typeName, "INTEGER");
        assert.strictEqual(result.isNullable, true);
      });

      it("parses INTEGER with NOT NULL", () => {
        const result = parseFlinkType("INTEGER NOT NULL");

        assert.strictEqual(result.typeName, "INTEGER");
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("BOOLEAN", () => {
      it("parses simple BOOLEAN", () => {
        const result = parseFlinkType("BOOLEAN");

        assert.strictEqual(result.typeName, "BOOLEAN");
        assert.strictEqual(result.isNullable, true);
      });

      it("parses BOOLEAN with NOT NULL", () => {
        const result = parseFlinkType("BOOLEAN NOT NULL");

        assert.strictEqual(result.typeName, "BOOLEAN");
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("DATE", () => {
      it("parses simple DATE", () => {
        const result = parseFlinkType("DATE");

        assert.strictEqual(result.typeName, "DATE");
        assert.strictEqual(result.isNullable, true);
      });

      it("parses DATE with NOT NULL", () => {
        const result = parseFlinkType("DATE NOT NULL");

        assert.strictEqual(result.typeName, "DATE");
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("DOUBLE", () => {
      it("parses simple DOUBLE", () => {
        const result = parseFlinkType("DOUBLE");

        assert.strictEqual(result.typeName, "DOUBLE");
        assert.strictEqual(result.isNullable, true);
      });

      it("parses DOUBLE with NOT NULL", () => {
        const result = parseFlinkType("DOUBLE NOT NULL");

        assert.strictEqual(result.typeName, "DOUBLE");
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("FLOAT", () => {
      it("parses simple FLOAT", () => {
        const result = parseFlinkType("FLOAT");

        assert.strictEqual(result.typeName, "FLOAT");
        assert.strictEqual(result.isNullable, true);
      });

      it("parses FLOAT with NOT NULL", () => {
        const result = parseFlinkType("FLOAT NOT NULL");

        assert.strictEqual(result.typeName, "FLOAT");
        assert.strictEqual(result.isNullable, false);
      });
    });
  });

  describe("parameterized types", () => {
    describe("VARCHAR", () => {
      it("parses VARCHAR without size", () => {
        const result = parseFlinkType("VARCHAR");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, undefined);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses VARCHAR(255)", () => {
        const result = parseFlinkType("VARCHAR(255)");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses VARCHAR(2147483647)", () => {
        const result = parseFlinkType("VARCHAR(2147483647)");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 2147483647);
      });

      it("parses VARCHAR(255) NOT NULL", () => {
        const result = parseFlinkType("VARCHAR(255) NOT NULL");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.isNullable, false);
      });

      it("parses VARCHAR with whitespace around size", () => {
        const result = parseFlinkType("VARCHAR ( 255 )");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 255);
      });
    });

    describe("CHAR", () => {
      it("parses CHAR without size", () => {
        const result = parseFlinkType("CHAR");

        assert.strictEqual(result.typeName, "CHAR");
        assert.strictEqual((result as any).maxLength, undefined);
      });

      it("parses CHAR(10)", () => {
        const result = parseFlinkType("CHAR(10)");

        assert.strictEqual(result.typeName, "CHAR");
        assert.strictEqual((result as any).maxLength, 10);
      });

      it("parses CHAR(10) NOT NULL", () => {
        const result = parseFlinkType("CHAR(10) NOT NULL");

        assert.strictEqual(result.typeName, "CHAR");
        assert.strictEqual((result as any).maxLength, 10);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("DECIMAL", () => {
      it("parses DECIMAL without parameters", () => {
        const result = parseFlinkType("DECIMAL");

        assert.strictEqual(result.typeName, "DECIMAL");
        assert.strictEqual((result as any).precision, undefined);
        assert.strictEqual((result as any).scale, undefined);
      });

      it("parses DECIMAL(10,2)", () => {
        const result = parseFlinkType("DECIMAL(10,2)");

        assert.strictEqual(result.typeName, "DECIMAL");
        assert.strictEqual((result as any).precision, 10);
        assert.strictEqual((result as any).scale, 2);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses DECIMAL(38,0)", () => {
        const result = parseFlinkType("DECIMAL(38,0)");

        assert.strictEqual((result as any).precision, 38);
        assert.strictEqual((result as any).scale, 0);
      });

      it("parses DECIMAL(10,2) NOT NULL", () => {
        const result = parseFlinkType("DECIMAL(10,2) NOT NULL");

        assert.strictEqual((result as any).precision, 10);
        assert.strictEqual((result as any).scale, 2);
        assert.strictEqual(result.isNullable, false);
      });

      it("parses DECIMAL with whitespace around parameters", () => {
        const result = parseFlinkType("DECIMAL ( 10 , 2 )");

        assert.strictEqual((result as any).precision, 10);
        assert.strictEqual((result as any).scale, 2);
      });
    });

    describe("NUMERIC", () => {
      it("parses NUMERIC(5,2)", () => {
        const result = parseFlinkType("NUMERIC(5,2)");

        assert.strictEqual(result.typeName, "NUMERIC");
        assert.strictEqual((result as any).precision, 5);
        assert.strictEqual((result as any).scale, 2);
      });

      it("parses NUMERIC(5,2) NOT NULL", () => {
        const result = parseFlinkType("NUMERIC(5,2) NOT NULL");

        assert.strictEqual((result as any).precision, 5);
        assert.strictEqual((result as any).scale, 2);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("TIMESTAMP", () => {
      it("parses simple TIMESTAMP", () => {
        const result = parseFlinkType("TIMESTAMP");

        assert.strictEqual(result.typeName, "TIMESTAMP");
        assert.strictEqual((result as any).precision, undefined);
      });

      it("parses TIMESTAMP(3)", () => {
        const result = parseFlinkType("TIMESTAMP(3)");

        assert.strictEqual(result.typeName, "TIMESTAMP");
        assert.strictEqual((result as any).precision, 3);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses TIMESTAMP(6)", () => {
        const result = parseFlinkType("TIMESTAMP(6)");

        assert.strictEqual((result as any).precision, 6);
      });

      it("parses TIMESTAMP(3) NOT NULL", () => {
        const result = parseFlinkType("TIMESTAMP(3) NOT NULL");

        assert.strictEqual((result as any).precision, 3);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("TIMESTAMP_LTZ", () => {
      it("parses simple TIMESTAMP_LTZ", () => {
        const result = parseFlinkType("TIMESTAMP_LTZ");

        assert.strictEqual(result.typeName, "TIMESTAMP_LTZ");
        assert.strictEqual((result as any).precision, undefined);
      });

      it("parses TIMESTAMP_LTZ(9)", () => {
        const result = parseFlinkType("TIMESTAMP_LTZ(9)");

        assert.strictEqual(result.typeName, "TIMESTAMP_LTZ");
        assert.strictEqual((result as any).precision, 9);
      });

      it("parses TIMESTAMP_LTZ(9) NOT NULL", () => {
        const result = parseFlinkType("TIMESTAMP_LTZ(9) NOT NULL");

        assert.strictEqual((result as any).precision, 9);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("BINARY", () => {
      it("parses BINARY without size", () => {
        const result = parseFlinkType("BINARY");

        assert.strictEqual(result.typeName, "BINARY");
        assert.strictEqual((result as any).maxLength, undefined);
      });

      it("parses BINARY(100)", () => {
        const result = parseFlinkType("BINARY(100)");

        assert.strictEqual(result.typeName, "BINARY");
        assert.strictEqual((result as any).maxLength, 100);
      });

      it("parses BINARY(100) NOT NULL", () => {
        const result = parseFlinkType("BINARY(100) NOT NULL");

        assert.strictEqual((result as any).maxLength, 100);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("VARBINARY", () => {
      it("parses VARBINARY without size", () => {
        const result = parseFlinkType("VARBINARY");

        assert.strictEqual(result.typeName, "VARBINARY");
        assert.strictEqual((result as any).maxLength, undefined);
      });

      it("parses VARBINARY(1024)", () => {
        const result = parseFlinkType("VARBINARY(1024)");

        assert.strictEqual(result.typeName, "VARBINARY");
        assert.strictEqual((result as any).maxLength, 1024);
      });

      it("parses VARBINARY(1024) NOT NULL", () => {
        const result = parseFlinkType("VARBINARY(1024) NOT NULL");

        assert.strictEqual((result as any).maxLength, 1024);
        assert.strictEqual(result.isNullable, false);
      });
    });
  });

  describe("array types", () => {
    describe("ARRAY<BIGINT>", () => {
      it("parses ARRAY<BIGINT>", () => {
        const result = parseFlinkType("ARRAY<BIGINT>");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.arrayMembersAreNullable, true);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses ARRAY<BIGINT> NOT NULL", () => {
        const result = parseFlinkType("ARRAY<BIGINT> NOT NULL");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.arrayMembersAreNullable, true);
        assert.strictEqual(result.isNullable, false);
      });

      it("parses ARRAY<BIGINT NOT NULL>", () => {
        const result = parseFlinkType("ARRAY<BIGINT NOT NULL>");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.arrayMembersAreNullable, false);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses ARRAY<BIGINT NOT NULL> NOT NULL", () => {
        const result = parseFlinkType("ARRAY<BIGINT NOT NULL> NOT NULL");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.arrayMembersAreNullable, false);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("ARRAY<VARCHAR>", () => {
      it("parses ARRAY<VARCHAR(255)>", () => {
        const result = parseFlinkType("ARRAY<VARCHAR(255)>");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.arrayMembersAreNullable, true);
      });

      it("parses ARRAY<VARCHAR(255) NOT NULL>", () => {
        const result = parseFlinkType("ARRAY<VARCHAR(255) NOT NULL>");

        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.arrayMembersAreNullable, false);
      });

      it("parses ARRAY<VARCHAR(255)> NOT NULL", () => {
        const result = parseFlinkType("ARRAY<VARCHAR(255)> NOT NULL");

        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.arrayMembersAreNullable, true);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("ARRAY<DECIMAL>", () => {
      it("parses ARRAY<DECIMAL(10,2)>", () => {
        const result = parseFlinkType("ARRAY<DECIMAL(10,2)>");

        assert.strictEqual(result.typeName, "DECIMAL");
        assert.strictEqual((result as any).precision, 10);
        assert.strictEqual((result as any).scale, 2);
        assert.strictEqual(result.isArray, true);
      });

      it("parses ARRAY<DECIMAL(10,2) NOT NULL>", () => {
        const result = parseFlinkType("ARRAY<DECIMAL(10,2) NOT NULL>");

        assert.strictEqual((result as any).precision, 10);
        assert.strictEqual((result as any).scale, 2);
        assert.strictEqual(result.arrayMembersAreNullable, false);
      });
    });

    describe("ARRAY<TIMESTAMP>", () => {
      it("parses ARRAY<TIMESTAMP(3)>", () => {
        const result = parseFlinkType("ARRAY<TIMESTAMP(3)>");

        assert.strictEqual(result.typeName, "TIMESTAMP");
        assert.strictEqual((result as any).precision, 3);
        assert.strictEqual(result.isArray, true);
      });

      it("parses ARRAY<TIMESTAMP(3) NOT NULL> NOT NULL", () => {
        const result = parseFlinkType("ARRAY<TIMESTAMP(3) NOT NULL> NOT NULL");

        assert.strictEqual((result as any).precision, 3);
        assert.strictEqual(result.arrayMembersAreNullable, false);
        assert.strictEqual(result.isNullable, false);
      });
    });
  });

  describe("multiset types", () => {
    describe("MULTISET<BIGINT>", () => {
      it("parses MULTISET<BIGINT>", () => {
        const result = parseFlinkType("MULTISET<BIGINT>");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isMultiset, true);
        assert.strictEqual(result.multisetMembersAreNullable, true);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses MULTISET<BIGINT> NOT NULL", () => {
        const result = parseFlinkType("MULTISET<BIGINT> NOT NULL");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isMultiset, true);
        assert.strictEqual(result.multisetMembersAreNullable, true);
        assert.strictEqual(result.isNullable, false);
      });

      it("parses MULTISET<BIGINT NOT NULL>", () => {
        const result = parseFlinkType("MULTISET<BIGINT NOT NULL>");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isMultiset, true);
        assert.strictEqual(result.multisetMembersAreNullable, false);
        assert.strictEqual(result.isNullable, true);
      });

      it("parses MULTISET<BIGINT NOT NULL> NOT NULL", () => {
        const result = parseFlinkType("MULTISET<BIGINT NOT NULL> NOT NULL");

        assert.strictEqual(result.typeName, "BIGINT");
        assert.strictEqual(result.isMultiset, true);
        assert.strictEqual(result.multisetMembersAreNullable, false);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("MULTISET<VARCHAR>", () => {
      it("parses MULTISET<VARCHAR(255)>", () => {
        const result = parseFlinkType("MULTISET<VARCHAR(255)>");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.isMultiset, true);
      });

      it("parses MULTISET<VARCHAR(255) NOT NULL>", () => {
        const result = parseFlinkType("MULTISET<VARCHAR(255) NOT NULL>");

        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.multisetMembersAreNullable, false);
      });
    });

    describe("MULTISET<DECIMAL>", () => {
      it("parses MULTISET<DECIMAL(10,2)>", () => {
        const result = parseFlinkType("MULTISET<DECIMAL(10,2)>");

        assert.strictEqual(result.typeName, "DECIMAL");
        assert.strictEqual((result as any).precision, 10);
        assert.strictEqual((result as any).scale, 2);
        assert.strictEqual(result.isMultiset, true);
      });
    });
  });

  describe("edge cases and error handling", () => {
    describe("case sensitivity", () => {
      it("normalizes type names to uppercase", () => {
        const result1 = parseFlinkType("varchar");
        const result2 = parseFlinkType("VARCHAR");
        const result3 = parseFlinkType("VarChar");

        assert.strictEqual(result1.typeName, "VARCHAR");
        assert.strictEqual(result2.typeName, "VARCHAR");
        assert.strictEqual(result3.typeName, "VARCHAR");
      });

      it("handles mixed case with NOT NULL", () => {
        const result = parseFlinkType("VarChar(255) NOT Null");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 255);
        assert.strictEqual(result.isNullable, false);
      });
    });

    describe("whitespace handling", () => {
      it("trims leading and trailing whitespace", () => {
        const result = parseFlinkType("  BIGINT  ");

        assert.strictEqual(result.typeName, "BIGINT");
      });

      it("handles whitespace around parameters", () => {
        const result = parseFlinkType("VARCHAR ( 255 )");

        assert.strictEqual(result.typeName, "VARCHAR");
        assert.strictEqual((result as any).maxLength, 255);
      });

      it("handles whitespace in NOT NULL", () => {
        const result = parseFlinkType("BIGINT  NOT  NULL");

        assert.strictEqual(result.isNullable, false);
      });

      it("handles whitespace in ARRAY", () => {
        const result = parseFlinkType("ARRAY < BIGINT >");

        assert.strictEqual(result.isArray, true);
        assert.strictEqual(result.typeName, "BIGINT");
      });
    });

    describe("unknown types", () => {
      it("parses unknown type names as FlinkAtomicType with name preserved", () => {
        const result = parseFlinkType("CUSTOM_TYPE");

        assert.strictEqual(result.typeName, "CUSTOM_TYPE");
        assert.strictEqual(result.isNullable, true);
      });

      it("handles unknown types with NOT NULL", () => {
        const result = parseFlinkType("CUSTOM_TYPE NOT NULL");

        assert.strictEqual(result.typeName, "CUSTOM_TYPE");
        assert.strictEqual(result.isNullable, false);
      });

      it("handles unknown types in ARRAY", () => {
        const result = parseFlinkType("ARRAY<CUSTOM_TYPE>");

        assert.strictEqual(result.typeName, "CUSTOM_TYPE");
        assert.strictEqual(result.isArray, true);
      });
    });

    describe("invalid input", () => {
      it("throws on empty string", () => {
        assert.throws(() => parseFlinkType(""), /invalid|empty|type/i);
      });

      it("throws on malformed ARRAY (missing closing bracket)", () => {
        assert.throws(() => parseFlinkType("ARRAY<BIGINT"), /invalid|malformed|bracket|unmatched/i);
      });

      it("throws on malformed parameters (missing closing paren)", () => {
        assert.throws(() => parseFlinkType("VARCHAR(255"), /invalid|malformed|paren/i);
      });

      it("throws on unclosed comment quote in ROW field", () => {
        assert.throws(
          () => parseFlinkType("ROW<topic VARCHAR 'unclosed comment, partition INT>"),
          /unclosed|quote/i,
        );
      });
    });
  });

  describe("ROW types", () => {
    describe("simple ROW", () => {
      it("parses ROW with single field", () => {
        const result = parseFlinkType("ROW<id BIGINT>");

        assert.strictEqual(result.typeName, "ROW");
        assert.strictEqual(result.isNullable, true);
        assert.strictEqual((result as any).children.length, 1);
        assert.strictEqual((result as any).children[0].rowFieldName, "id");
        assert.strictEqual((result as any).children[0].typeName, "BIGINT");
      });

      it("parses ROW with multiple fields", () => {
        const result = parseFlinkType("ROW<id BIGINT, name VARCHAR>");

        assert.strictEqual(result.typeName, "ROW");
        assert.strictEqual((result as any).children.length, 2);
        assert.strictEqual((result as any).children[0].rowFieldName, "id");
        assert.strictEqual((result as any).children[0].typeName, "BIGINT");
        assert.strictEqual((result as any).children[1].rowFieldName, "name");
        assert.strictEqual((result as any).children[1].typeName, "VARCHAR");
      });

      it("parses ROW with NOT NULL", () => {
        const result = parseFlinkType("ROW<id BIGINT> NOT NULL");

        assert.strictEqual(result.typeName, "ROW");
        assert.strictEqual(result.isNullable, false);
      });

      it("parses ROW with field-level nullability", () => {
        const result = parseFlinkType("ROW<id BIGINT NOT NULL, name VARCHAR>");

        assert.strictEqual((result as any).children[0].isNullable, false);
        assert.strictEqual((result as any).children[1].isNullable, true);
      });

      it("parses ROW with parameterized types", () => {
        const result = parseFlinkType(
          "ROW<id BIGINT NOT NULL, name VARCHAR(255), price DECIMAL(10,2)>",
        );

        assert.strictEqual((result as any).children[2].typeName, "DECIMAL");
        assert.strictEqual((result as any).children[2].precision, 10);
        assert.strictEqual((result as any).children[2].scale, 2);
      });
    });

    describe("nested ROW types", () => {
      it("parses ROW with nested ROW", () => {
        const result = parseFlinkType(
          "ROW<id BIGINT, metadata ROW<created BIGINT, updated BIGINT>>",
        );

        assert.strictEqual((result as any).children.length, 2);
        assert.strictEqual((result as any).children[1].rowFieldName, "metadata");
        assert.strictEqual((result as any).children[1].typeName, "ROW");
        assert.strictEqual((result as any).children[1].children.length, 2);
        assert.strictEqual((result as any).children[1].children[0].rowFieldName, "created");
      });

      it("parses ROW with ARRAY field", () => {
        const result = parseFlinkType("ROW<id BIGINT, tags ARRAY<VARCHAR>>");

        assert.strictEqual((result as any).children[1].rowFieldName, "tags");
        assert.strictEqual((result as any).children[1].isArray, true);
        assert.strictEqual((result as any).children[1].typeName, "VARCHAR");
      });

      it("parses ROW with nested ARRAY of ROW", () => {
        const result = parseFlinkType(
          "ROW<id BIGINT, items ARRAY<ROW<item_id BIGINT, qty INTEGER>>>",
        );

        assert.strictEqual((result as any).children[1].rowFieldName, "items");
        assert.strictEqual((result as any).children[1].isArray, true);
        assert.strictEqual((result as any).children[1].typeName, "ROW");
        assert.strictEqual((result as any).children[1].children.length, 2);
      });
    });
  });

  describe("MAP types", () => {
    describe("simple MAP", () => {
      it("parses MAP with primitive types", () => {
        const result = parseFlinkType("MAP<VARCHAR, BIGINT>");

        assert.strictEqual(result.typeName, "MAP");
        assert.strictEqual((result as any).children.length, 2);
        assert.strictEqual((result as any).children[0].rowFieldName, "key");
        assert.strictEqual((result as any).children[0].typeName, "VARCHAR");
        assert.strictEqual((result as any).children[1].rowFieldName, "value");
        assert.strictEqual((result as any).children[1].typeName, "BIGINT");
      });

      it("parses MAP with parameterized types", () => {
        const result = parseFlinkType("MAP<VARCHAR(255), DECIMAL(10,2)>");

        assert.strictEqual((result as any).children[0].maxLength, 255);
        assert.strictEqual((result as any).children[1].precision, 10);
        assert.strictEqual((result as any).children[1].scale, 2);
      });

      it("parses MAP with NOT NULL", () => {
        const result = parseFlinkType("MAP<VARCHAR, BIGINT> NOT NULL");

        assert.strictEqual(result.isNullable, false);
      });

      it("parses MAP with nullable value", () => {
        const result = parseFlinkType("MAP<VARCHAR, BIGINT>");

        assert.strictEqual((result as any).children[1].isNullable, true);
      });
    });

    describe("complex MAP", () => {
      it("parses MAP with ROW value", () => {
        const result = parseFlinkType("MAP<VARCHAR, ROW<id BIGINT, name VARCHAR>>");

        assert.strictEqual((result as any).children[1].typeName, "ROW");
        assert.strictEqual((result as any).children[1].children.length, 2);
      });

      it("parses MAP with ARRAY value", () => {
        const result = parseFlinkType("MAP<VARCHAR, ARRAY<BIGINT>>");

        assert.strictEqual((result as any).children[1].isArray, true);
        assert.strictEqual((result as any).children[1].typeName, "BIGINT");
      });
    });
  });

  describe("complex real-world types", () => {
    it("Test Spotify Topic Type", () => {
      // Simplified Spotify track type structure
      const spotifyType =
        "ROW<album ROW<album_type VARCHAR NOT NULL, artists ARRAY<ROW<href VARCHAR NOT NULL, id VARCHAR NOT NULL, name VARCHAR NOT NULL, type VARCHAR NOT NULL, uri VARCHAR NOT NULL> NOT NULL> NOT NULL, href VARCHAR NOT NULL, id VARCHAR NOT NULL, images ARRAY<ROW<height BIGINT, url VARCHAR NOT NULL, width BIGINT> NOT NULL> NOT NULL, name VARCHAR NOT NULL, release_date VARCHAR NOT NULL, release_date_precision VARCHAR NOT NULL, total_tracks BIGINT NOT NULL, type VARCHAR NOT NULL, uri VARCHAR NOT NULL> NOT NULL, artists ARRAY<ROW<href VARCHAR NOT NULL, id VARCHAR NOT NULL, name VARCHAR NOT NULL, type VARCHAR NOT NULL, uri VARCHAR NOT NULL> NOT NULL> NOT NULL, disc_number BIGINT NOT NULL, duration_ms BIGINT NOT NULL, explicit BOOLEAN NOT NULL, href VARCHAR NOT NULL, id VARCHAR NOT NULL, is_local BOOLEAN NOT NULL, name VARCHAR NOT NULL, popularity BIGINT NOT NULL, preview_url VARCHAR, track_number BIGINT NOT NULL, type VARCHAR NOT NULL, uri VARCHAR NOT NULL>";

      const result = parseFlinkType(spotifyType);

      // Verify root is ROW
      assert.strictEqual(result.typeName, "ROW");
      assert.strictEqual(result.isNullable, true); // No NOT NULL on outer ROW
      assert.ok((result as any).children.length > 0);

      // Verify first field is 'album' which is a ROW
      const albumField = (result as any).children[0];
      assert.strictEqual(albumField.rowFieldName, "album");
      assert.strictEqual(albumField.typeName, "ROW");
      assert.strictEqual(albumField.isNullable, false); // album is NOT NULL

      // Verify album.artists field is ARRAY of ROW
      const albumArtistsField = albumField.children.find((f: any) => f.rowFieldName === "artists");
      assert.ok(albumArtistsField !== undefined);
      assert.strictEqual(albumArtistsField.isArray, true);
      assert.strictEqual(albumArtistsField.typeName, "ROW");
      assert.strictEqual(albumArtistsField.arrayMembersAreNullable, false);

      // Verify artist ROW structure
      const artistFields = albumArtistsField.children;
      assert.ok(artistFields.length > 0);
      const hrefField = artistFields.find((f: any) => f.rowFieldName === "href");
      assert.strictEqual(hrefField.typeName, "VARCHAR");
      assert.strictEqual(hrefField.isNullable, false);

      // Verify top-level fields
      const artistsField = (result as any).children.find((f: any) => f.rowFieldName === "artists");
      assert.ok(artistsField !== undefined);
      assert.strictEqual(artistsField.isArray, true);
      assert.strictEqual(artistsField.typeName, "ROW");

      const discNumberField = (result as any).children.find(
        (f: any) => f.rowFieldName === "disc_number",
      );
      assert.strictEqual(discNumberField.typeName, "BIGINT");
      assert.strictEqual(discNumberField.isNullable, false);

      // Verify nullable field
      const previewUrlField = (result as any).children.find(
        (f: any) => f.rowFieldName === "preview_url",
      );
      assert.strictEqual(previewUrlField.typeName, "VARCHAR");
      assert.strictEqual(previewUrlField.isNullable, true); // No NOT NULL
    });

    it("ROW with field comments - Kafka connector metadata", () => {
      const kafkaMetadataType =
        "ROW<`topic` VARCHAR(2147483647) 'The topic of the Kafka source record.', " +
        "`partition` INT 'The partition of the Kafka source record.', " +
        "`offset` BIGINT 'The offset of the Kafka source record.', " +
        "`timestamp` TIMESTAMP_LTZ(3) 'The timestamp of the Kafka source record. The value is in milliseconds since epoch. The specific meaning of the timestamp depends on timestamp_type.'," +
        "`timestamp_type` VARCHAR(2147483647) 'The type of the timestamp in the Kafka source record. Possible values are ''CREATE_TIME'' and ''LOG_APPEND_TIME''.', " +
        "`headers` MAP<VARCHAR(2147483647), VARBINARY(2147483647)> 'The headers of the Kafka source record. The keys are strings and values are byte arrays. Note that for multiple headers with the same key, only the first one is kept in the map.', " +
        "`key` VARBINARY(2147483647) 'The key of the Kafka source record. May be null if the record has no key.', " +
        "`value` VARBINARY(2147483647) 'The value of the Kafka source record. May be null if the record has no value (tombstone record).'>";

      const result = parseFlinkType(kafkaMetadataType);

      assert.strictEqual(result.typeName, "ROW");
      assert.strictEqual((result as any).children.length, 8);

      // Verify topic field
      const topicField = (result as any).children[0];
      assert.strictEqual(topicField.rowFieldName, "topic");
      assert.strictEqual(topicField.typeName, "VARCHAR");
      assert.strictEqual(topicField.comment, "The topic of the Kafka source record.");

      // Verify partition field
      const partitionField = (result as any).children[1];
      assert.strictEqual(partitionField.rowFieldName, "partition");
      assert.strictEqual(partitionField.typeName, "INT");
      assert.strictEqual(partitionField.comment, "The partition of the Kafka source record.");

      // Verify offset field
      const offsetField = (result as any).children[2];
      assert.strictEqual(offsetField.rowFieldName, "offset");
      assert.strictEqual(offsetField.typeName, "BIGINT");
      assert.strictEqual(offsetField.comment, "The offset of the Kafka source record.");

      // Verify timestamp field (tests TIMESTAMP_LTZ with comment)
      const timestampField = (result as any).children[3];
      assert.strictEqual(timestampField.rowFieldName, "timestamp");
      assert.strictEqual(timestampField.typeName, "TIMESTAMP_LTZ");
      assert.strictEqual((timestampField as any).precision, 3);
      assert.ok(timestampField.comment?.includes("milliseconds since epoch"));

      // Verify timestamp_type field (tests escaped quotes in comment)
      const timestampTypeField = (result as any).children[4];
      assert.strictEqual(timestampTypeField.rowFieldName, "timestamp_type");
      assert.strictEqual(timestampTypeField.typeName, "VARCHAR");
      assert.ok(timestampTypeField.comment?.includes("'CREATE_TIME'"));
      assert.ok(timestampTypeField.comment?.includes("'LOG_APPEND_TIME'"));

      // Verify headers field (tests MAP with comment)
      const headersField = (result as any).children[5];
      assert.strictEqual(headersField.rowFieldName, "headers");
      assert.strictEqual(headersField.typeName, "MAP");
      assert.ok(headersField.comment?.includes("headers of the Kafka source record"));

      // Verify key field
      const keyField = (result as any).children[6];
      assert.strictEqual(keyField.rowFieldName, "key");
      assert.strictEqual(keyField.typeName, "VARBINARY");
      assert.strictEqual(
        keyField.comment,
        "The key of the Kafka source record. May be null if the record has no key.",
      );

      // Verify value field
      const valueField = (result as any).children[7];
      assert.strictEqual(valueField.rowFieldName, "value");
      assert.strictEqual(valueField.typeName, "VARBINARY");
      assert.ok(valueField.comment?.includes("tombstone record"));
    });

    it("Complex Spotify audio analysis ROW with nested metadata", () => {
      const spotifyAnalysisType =
        "ROW<`meta` ROW<`analyzer_version` VARCHAR(2147483647) NOT NULL, " +
        "`platform` VARCHAR(2147483647) NOT NULL, `detailed_status` VARCHAR(2147483647) NOT NULL, " +
        "`status_code` BIGINT NOT NULL, `timestamp` BIGINT NOT NULL, `analysis_time` DOUBLE NOT NULL, " +
        "`input_process` VARCHAR(2147483647) NOT NULL>, " +
        "`track` ROW<`num_samples` BIGINT NOT NULL, `duration` DOUBLE NOT NULL, " +
        "`sample_md5` VARCHAR(2147483647) NOT NULL, `offset_seconds` BIGINT NOT NULL, " +
        "`window_seconds` BIGINT NOT NULL, `analysis_sample_rate` BIGINT NOT NULL, " +
        "`analysis_channels` BIGINT NOT NULL, `end_of_fade_in` DOUBLE NOT NULL, " +
        "`start_of_fade_out` DOUBLE NOT NULL, `loudness` DOUBLE NOT NULL, `tempo` DOUBLE NOT NULL, " +
        "`tempo_confidence` DOUBLE NOT NULL, `time_signature` BIGINT NOT NULL, " +
        "`time_signature_confidence` DOUBLE NOT NULL, `key` BIGINT NOT NULL, " +
        "`key_confidence` DOUBLE NOT NULL, `key_mapped` VARCHAR(2147483647) NOT NULL, " +
        "`mode` BIGINT NOT NULL, `mode_confidence` DOUBLE NOT NULL>>";

      const result = parseFlinkType(spotifyAnalysisType);

      assert.strictEqual(result.typeName, "ROW");
      assert.strictEqual((result as any).children.length, 2);

      // Verify meta field
      const metaField = (result as any).children[0];
      assert.strictEqual(metaField.rowFieldName, "meta");
      assert.strictEqual(metaField.typeName, "ROW");
      assert.strictEqual(metaField.children.length, 7);
      assert.strictEqual(metaField.children[0].rowFieldName, "analyzer_version");
      assert.strictEqual(metaField.children[0].isNullable, false);

      // Verify track field
      const trackField = (result as any).children[1];
      assert.strictEqual(trackField.rowFieldName, "track");
      assert.strictEqual(trackField.typeName, "ROW");
      assert.strictEqual(trackField.children.length, 19);
      const durationField = trackField.children.find((f: any) => f.rowFieldName === "duration");
      assert.strictEqual(durationField.typeName, "DOUBLE");
      assert.strictEqual(durationField.isNullable, false);
    });
  });

  describe("error handling and edge cases", () => {
    it("throws when input is only NOT NULL (no type found)", () => {
      assert.throws(() => parseFlinkType("NOT NULL"), /No type found in input/);
    });

    it("throws on unclosed backtick in ROW field name", () => {
      assert.throws(() => parseFlinkType("ROW<`unclosed_field VARCHAR>"), /unclosed backtick/i);
    });

    it("throws on invalid ROW field name (doesn't match identifier pattern)", () => {
      assert.throws(() => parseFlinkType("ROW<123 BIGINT>"), /Invalid ROW field syntax/);
    });

    it("throws on invalid MAP syntax (no separator comma)", () => {
      assert.throws(() => parseFlinkType("MAP<VARCHAR>"), /Invalid MAP syntax/i);
    });

    it("throws on invalid type syntax that regex cannot parse", () => {
      assert.throws(() => parseFlinkType("(broken)"), /Invalid type syntax/);
    });

    it("throws on empty string after trimming", () => {
      assert.throws(() => parseFlinkType("   "), /Input must be a non-empty string/);
    });

    it("parses ROW field with empty/whitespace-only comment", () => {
      const result = parseFlinkType("ROW<topic VARCHAR '   '>");

      assert.strictEqual(result.typeName, "ROW");
      const topicField = (result as any).children[0];
      assert.strictEqual(topicField.rowFieldName, "topic");
      assert.strictEqual(topicField.typeName, "VARCHAR");
      // Empty comment (after trim) should not be set
      assert.strictEqual(topicField.comment, undefined);
    });
  });
});
