import * as assert from "assert";
import * as sinon from "sinon";
import { Position, Range, Uri } from "vscode";
import * as fileUtils from "../utils/file";
import type { ExecutableBlock, ParsedStatement } from "./flinkSql";
import {
  classifyStatementType,
  getBlockAtLine,
  groupStatementsIntoBlocks,
  parseFlinkSqlDocument,
  StatementType,
} from "./flinkSql";

describe("documentParsing/flinkSql.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("classifyStatementType()", () => {
    it("should identify SET statements", () => {
      assert.strictEqual(classifyStatementType("SET 'key' = 'value';"), StatementType.SET);
      assert.strictEqual(classifyStatementType("  SET 'key' = 'value'"), StatementType.SET);
      assert.strictEqual(classifyStatementType("set 'key' = 'value';"), StatementType.SET);
    });

    it("should identify USE statements", () => {
      assert.strictEqual(classifyStatementType("USE CATALOG my_catalog;"), StatementType.USE);
      assert.strictEqual(classifyStatementType("USE my_database;"), StatementType.USE);
      assert.strictEqual(classifyStatementType("USE MODULES core;"), StatementType.USE);
      assert.strictEqual(classifyStatementType("  use catalog test"), StatementType.USE);
    });

    it("should identify SELECT as EXECUTABLE", () => {
      assert.strictEqual(classifyStatementType("SELECT * FROM table1;"), StatementType.EXECUTABLE);
      assert.strictEqual(
        classifyStatementType("  select id from users;"),
        StatementType.EXECUTABLE,
      );
    });

    it("should identify INSERT as EXECUTABLE", () => {
      assert.strictEqual(
        classifyStatementType("INSERT INTO table2 SELECT * FROM table1;"),
        StatementType.EXECUTABLE,
      );
    });

    it("should identify CREATE as EXECUTABLE", () => {
      assert.strictEqual(
        classifyStatementType("CREATE TABLE my_table (id INT);"),
        StatementType.EXECUTABLE,
      );
      assert.strictEqual(
        classifyStatementType("CREATE FUNCTION my_func AS 'MyClass';"),
        StatementType.EXECUTABLE,
      );
    });

    it("should identify DROP as EXECUTABLE", () => {
      assert.strictEqual(classifyStatementType("DROP TABLE my_table;"), StatementType.EXECUTABLE);
    });

    it("should identify ALTER as EXECUTABLE", () => {
      assert.strictEqual(
        classifyStatementType("ALTER TABLE my_table ADD COLUMN name STRING;"),
        StatementType.EXECUTABLE,
      );
    });

    it("should identify SHOW as EXECUTABLE", () => {
      assert.strictEqual(classifyStatementType("SHOW TABLES;"), StatementType.EXECUTABLE);
      assert.strictEqual(classifyStatementType("SHOW DATABASES;"), StatementType.EXECUTABLE);
    });

    it("should identify DESCRIBE as EXECUTABLE", () => {
      assert.strictEqual(classifyStatementType("DESCRIBE my_table;"), StatementType.EXECUTABLE);
      assert.strictEqual(classifyStatementType("DESC my_table;"), StatementType.EXECUTABLE);
    });
  });

  describe("groupStatementsIntoBlocks()", () => {
    function createStatement(
      text: string,
      type: StatementType,
      startLine: number,
      endLine: number,
    ): ParsedStatement {
      return {
        text,
        type,
        range: new Range(new Position(startLine, 0), new Position(endLine, text.length)),
      };
    }

    it("should create one block for a single executable statement", () => {
      const statements: ParsedStatement[] = [
        createStatement("SELECT * FROM table1;", StatementType.EXECUTABLE, 0, 0),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 1);
      assert.strictEqual(blocks[0].hasConfigStatements, false);
      assert.strictEqual(blocks[0].index, 0);
    });

    it("should group SET with next executable statement", () => {
      const statements: ParsedStatement[] = [
        createStatement("SET 'key' = 'value';", StatementType.SET, 0, 0),
        createStatement("SELECT * FROM table1;", StatementType.EXECUTABLE, 1, 1),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 2);
      assert.strictEqual(blocks[0].hasConfigStatements, true);
      assert.strictEqual(blocks[0].statements[0].type, StatementType.SET);
      assert.strictEqual(blocks[0].statements[1].type, StatementType.EXECUTABLE);
    });

    it("should group USE with next executable statement", () => {
      const statements: ParsedStatement[] = [
        createStatement("USE CATALOG my_catalog;", StatementType.USE, 0, 0),
        createStatement("INSERT INTO t2 SELECT * FROM t1;", StatementType.EXECUTABLE, 1, 1),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 2);
      assert.strictEqual(blocks[0].hasConfigStatements, true);
    });

    it("should group multiple SET/USE with next executable", () => {
      const statements: ParsedStatement[] = [
        createStatement("SET 'key1' = 'value1';", StatementType.SET, 0, 0),
        createStatement("SET 'key2' = 'value2';", StatementType.SET, 1, 1),
        createStatement("USE CATALOG my_catalog;", StatementType.USE, 2, 2),
        createStatement("SELECT * FROM table1;", StatementType.EXECUTABLE, 3, 3),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 4);
      assert.strictEqual(blocks[0].hasConfigStatements, true);
      assert.strictEqual(blocks[0].text.includes("SET 'key1'"), true);
      assert.strictEqual(blocks[0].text.includes("SET 'key2'"), true);
      assert.strictEqual(blocks[0].text.includes("USE CATALOG"), true);
      assert.strictEqual(blocks[0].text.includes("SELECT"), true);
    });

    it("should create separate blocks for independent statements", () => {
      const statements: ParsedStatement[] = [
        createStatement("SELECT * FROM table1;", StatementType.EXECUTABLE, 0, 0),
        createStatement("INSERT INTO t2 SELECT * FROM t1;", StatementType.EXECUTABLE, 2, 2),
        createStatement("CREATE TABLE t3 (id INT);", StatementType.EXECUTABLE, 4, 4),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 3);
      assert.strictEqual(blocks[0].index, 0);
      assert.strictEqual(blocks[1].index, 1);
      assert.strictEqual(blocks[2].index, 2);
      assert.strictEqual(blocks[0].hasConfigStatements, false);
      assert.strictEqual(blocks[1].hasConfigStatements, false);
      assert.strictEqual(blocks[2].hasConfigStatements, false);
    });

    it("should skip orphaned SET/USE at end of document", () => {
      const statements: ParsedStatement[] = [
        createStatement("SELECT * FROM table1;", StatementType.EXECUTABLE, 0, 0),
        createStatement("SET 'key' = 'value';", StatementType.SET, 2, 2),
        createStatement("USE CATALOG my_catalog;", StatementType.USE, 3, 3),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 1);
      assert.strictEqual(blocks[0].statements[0].type, StatementType.EXECUTABLE);
    });

    it("should handle mixed configuration and executable statements", () => {
      const statements: ParsedStatement[] = [
        createStatement("SET 'key1' = 'value1';", StatementType.SET, 0, 0),
        createStatement("SELECT * FROM table1;", StatementType.EXECUTABLE, 1, 1),
        createStatement("SET 'key2' = 'value2';", StatementType.SET, 3, 3),
        createStatement("USE CATALOG catalog2;", StatementType.USE, 4, 4),
        createStatement("INSERT INTO t2 SELECT * FROM t1;", StatementType.EXECUTABLE, 5, 5),
        createStatement("DROP TABLE t3;", StatementType.EXECUTABLE, 7, 7),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 3);

      // First block: SET + SELECT
      assert.strictEqual(blocks[0].statements.length, 2);
      assert.strictEqual(blocks[0].hasConfigStatements, true);

      // Second block: SET + USE + INSERT
      assert.strictEqual(blocks[1].statements.length, 3);
      assert.strictEqual(blocks[1].hasConfigStatements, true);

      // Third block: DROP (standalone)
      assert.strictEqual(blocks[2].statements.length, 1);
      assert.strictEqual(blocks[2].hasConfigStatements, false);
    });

    it("should handle empty statements array", () => {
      const blocks = groupStatementsIntoBlocks([]);
      assert.strictEqual(blocks.length, 0);
    });

    it("should handle only SET/USE statements (all orphaned)", () => {
      const statements: ParsedStatement[] = [
        createStatement("SET 'key1' = 'value1';", StatementType.SET, 0, 0),
        createStatement("USE CATALOG my_catalog;", StatementType.USE, 1, 1),
        createStatement("SET 'key2' = 'value2';", StatementType.SET, 2, 2),
      ];

      const blocks = groupStatementsIntoBlocks(statements);

      assert.strictEqual(blocks.length, 0);
    });
  });

  describe("getBlockAtLine()", () => {
    function createBlock(startLine: number, endLine: number, index: number): ExecutableBlock {
      const statement: ParsedStatement = {
        text: "SELECT * FROM table1;",
        type: StatementType.EXECUTABLE,
        range: new Range(new Position(startLine, 0), new Position(endLine, 20)),
      };
      return {
        statements: [statement],
        range: statement.range,
        text: statement.text,
        hasConfigStatements: false,
        index,
      };
    }

    it("should find block containing given line", () => {
      const blocks: ExecutableBlock[] = [
        createBlock(0, 2, 0),
        createBlock(5, 7, 1),
        createBlock(10, 12, 2),
      ];

      const block1 = getBlockAtLine(blocks, 1);
      assert.strictEqual(block1?.index, 0);

      const block2 = getBlockAtLine(blocks, 6);
      assert.strictEqual(block2?.index, 1);

      const block3 = getBlockAtLine(blocks, 11);
      assert.strictEqual(block3?.index, 2);
    });

    it("should return undefined for line outside any block", () => {
      const blocks: ExecutableBlock[] = [createBlock(0, 2, 0), createBlock(5, 7, 1)];

      const result = getBlockAtLine(blocks, 4);
      assert.strictEqual(result, undefined);
    });

    it("should handle line at block boundary", () => {
      const blocks: ExecutableBlock[] = [createBlock(0, 5, 0), createBlock(6, 10, 1)];

      const blockStart = getBlockAtLine(blocks, 0);
      assert.strictEqual(blockStart?.index, 0);

      const blockEnd = getBlockAtLine(blocks, 5);
      assert.strictEqual(blockEnd?.index, 0);

      const nextBlockStart = getBlockAtLine(blocks, 6);
      assert.strictEqual(nextBlockStart?.index, 1);
    });

    it("should return undefined for empty blocks array", () => {
      const result = getBlockAtLine([], 5);
      assert.strictEqual(result, undefined);
    });
  });

  describe("parseFlinkSqlDocument()", () => {
    let getEditorOrFileContentsStub: sinon.SinonStub;
    const fakeFileUri = Uri.file("/path/to/fake.flinksql");

    beforeEach(() => {
      getEditorOrFileContentsStub = sandbox.stub(fileUtils, "getEditorOrFileContents");
    });

    it("should return empty array for empty document", async () => {
      getEditorOrFileContentsStub.resolves({ content: "" });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 0);
    });

    it("should return empty array for whitespace-only document", async () => {
      getEditorOrFileContentsStub.resolves({ content: "   \n\n  \t  \n" });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 0);
    });

    it("should parse single SELECT statement", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT * FROM table1;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 1);
      assert.strictEqual(blocks[0].statements[0].type, StatementType.EXECUTABLE);
      assert.strictEqual(blocks[0].hasConfigStatements, false);
    });

    it("should parse and group SET with SELECT", async () => {
      getEditorOrFileContentsStub.resolves({
        content: `SET 'sql-client.execution.mode' = 'table';
SELECT * FROM table1;`,
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 2);
      assert.strictEqual(blocks[0].statements[0].type, StatementType.SET);
      assert.strictEqual(blocks[0].statements[1].type, StatementType.EXECUTABLE);
      assert.strictEqual(blocks[0].hasConfigStatements, true);
    });

    it("should parse multiple independent statements", async () => {
      getEditorOrFileContentsStub.resolves({
        content: `SELECT * FROM table1;

INSERT INTO table2 SELECT * FROM table1;

SELECT COUNT(*) FROM table3;`,
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 3);
      assert.strictEqual(blocks[0].index, 0);
      assert.strictEqual(blocks[1].index, 1);
      assert.strictEqual(blocks[2].index, 2);
    });

    it("should handle document with only comments", async () => {
      getEditorOrFileContentsStub.resolves({
        content: `-- This is a comment
/* This is a
   multi-line comment */`,
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      // Parser should return empty array for comment-only document
      assert.strictEqual(blocks.length, 0, JSON.stringify(blocks, null, 2));
    });

    it("should skip orphaned SET/USE statements", async () => {
      getEditorOrFileContentsStub.resolves({
        content: `SELECT * FROM table1;
SET 'key' = 'value';
USE CATALOG my_catalog;`,
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      // Should only have one block (the SELECT), orphaned SET/USE are skipped
      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements.length, 1);
      assert.strictEqual(blocks[0].statements[0].type, StatementType.EXECUTABLE);
    });

    it("should handle multi-line statements", async () => {
      getEditorOrFileContentsStub.resolves({
        content: `SELECT
  id,
  name,
  email
FROM users
WHERE active = true;`,
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 1);
      assert.strictEqual(blocks[0].statements[0].range.start.line, 0);
      assert.ok(blocks[0].statements[0].range.end.line > 0);
    });

    it("should return empty array when getEditorOrFileContents throws", async () => {
      getEditorOrFileContentsStub.rejects(new Error("File not found"));

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 0);
    });

    // --- edge cases: semicolons and special characters inside strings/comments ---

    it("should not split on semicolons inside string literals", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT * FROM t WHERE name = 'foo;bar';",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 1);
      assert.ok(blocks[0].text.includes("'foo;bar'"));
    });

    it("should not treat -- inside strings as comments", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT * FROM t WHERE name = '--not-a-comment';\nSELECT 1;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
      assert.ok(blocks[0].text.includes("'--not-a-comment'"));
    });

    it("should not treat apostrophes inside single-line comments as string delimiters", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "-- Here's a comment\nSELECT 1;\nSELECT 2;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
    });

    it("should not treat apostrophes inside multi-line comments as string delimiters", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "/* it's a multi-line\n   comment */\nSELECT 1;\nSELECT 2;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
    });

    it("should ignore semicolons inside single-line comments", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT * FROM t1; -- comment with ; semicolon\nSELECT * FROM t2;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
    });

    it("should ignore semicolons inside multi-line comments", async () => {
      getEditorOrFileContentsStub.resolves({
        content:
          "SELECT * FROM t1;\n/* comment spanning\n   multiple lines; with semicolons */\nSELECT * FROM t2;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
    });

    it("should handle escaped quotes in strings", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT * FROM t WHERE name = 'it''s a value';\nSELECT 1;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
      assert.ok(blocks[0].text.includes("it''s a value"));
    });

    it("should handle backtick identifiers containing apostrophes", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT * FROM `table's`;\nSELECT 1;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
    });

    it("should handle backtick identifiers containing -- comment markers", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT `col--name` FROM t;\nSELECT 1;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
    });

    it("should handle unclosed string gracefully", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT 'unclosed string FROM table1;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      // unclosed string regex fails to match, so the ' is treated as code and the
      // semicolon is found normally. the language server handles the syntax error.
      assert.ok(blocks.length >= 0);
    });

    it("should handle unclosed multi-line comment gracefully", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT * FROM t1; /* unclosed comment\nSELECT * FROM t2;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      // unclosed comment regex fails to match, so /* is treated as code and both
      // semicolons are found. the language server handles the syntax error.
      assert.ok(blocks.length >= 1);
    });

    it("should handle real-world Flink SQL with backticks and advanced syntax", async () => {
      getEditorOrFileContentsStub.resolves({
        content: `SELECT
  played_at,
  \`track\`.name AS track_name,
  \`track\`.album.name AS album_name,
  \`track\`.artists[1].name AS artist_name,
  genres
FROM \`realworld-data-env\`.\`realworld-data-cluster\`.\`spotify-listening-data\`
WHERE played_at IS NOT NULL
ORDER BY played_at DESC
LIMIT 10;`,
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 1);
      assert.ok(blocks[0].text.includes("artists[1]"));
      assert.ok(blocks[0].text.includes("LIMIT 10"));
    });

    it("should handle mixed strings, comments, and code together", async () => {
      getEditorOrFileContentsStub.resolves({
        content: "SELECT 'string; with; text' AS col1 FROM t1; -- comment; here\nSELECT * FROM t2;",
      });

      const blocks = await parseFlinkSqlDocument(fakeFileUri);

      assert.strictEqual(blocks.length, 2);
    });
  });

  describe("classifyStatementType() edge cases", () => {
    it("should classify correctly when comments contain apostrophes", () => {
      assert.strictEqual(
        classifyStatementType("-- Here's a note\nSELECT * FROM t;"),
        StatementType.EXECUTABLE,
      );
    });

    it("should not misclassify string content as SET keyword", () => {
      assert.strictEqual(
        classifyStatementType("SELECT 'SET value' FROM t;"),
        StatementType.EXECUTABLE,
      );
    });

    it("should not misclassify string content as USE keyword", () => {
      assert.strictEqual(
        classifyStatementType("SELECT 'USE CATALOG foo' FROM t;"),
        StatementType.EXECUTABLE,
      );
    });
  });
});
