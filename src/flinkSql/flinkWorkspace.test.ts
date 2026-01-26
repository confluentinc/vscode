import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { WsV1BlockTypeEnum, type GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import * as quickPickUtils from "../quickpicks/utils/quickPickUtils";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";
import type { ExtractedSqlStatement, WorkspaceMetadataContext } from "./flinkWorkspace";
import {
  extractSqlStatementsFromWorkspace,
  openSqlStatementsAsDocuments,
  selectSqlStatementsForOpening,
} from "./flinkWorkspace";
import * as statementUtils from "./statementUtils";

describe("flinkSql/flinkWorkspace.ts", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("openSqlStatementsAsDocuments()", function () {
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setFlinkDocumentMetadataStub: sinon.SinonStub;

    const statement = "SELECT * FROM my_table";
    const mockDocument = createMockDocument(statement);

    beforeEach(() => {
      openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
      showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
      setFlinkDocumentMetadataStub = sandbox.stub(statementUtils, "setFlinkDocumentMetadata");
    });

    function createMockDocument(content: string): vscode.TextDocument {
      return {
        uri: vscode.Uri.parse(`untitled:${content.substring(0, 10)}`),
        languageId: FLINK_SQL_LANGUAGE_ID,
        getText: () => content,
      } as vscode.TextDocument;
    }

    it("should do nothing when given an empty array", async function () {
      await openSqlStatementsAsDocuments([]);

      sinon.assert.notCalled(openTextDocumentStub);
      sinon.assert.notCalled(showTextDocumentStub);
      sinon.assert.notCalled(setFlinkDocumentMetadataStub);
    });

    it("should open a single statement as a document without metadata", async function () {
      openTextDocumentStub.resolves(mockDocument);

      await openSqlStatementsAsDocuments([statement]);

      sinon.assert.calledOnce(openTextDocumentStub);
      sinon.assert.calledWith(openTextDocumentStub, {
        language: FLINK_SQL_LANGUAGE_ID,
        content: statement,
      });

      sinon.assert.calledOnce(showTextDocumentStub);
      sinon.assert.calledWith(showTextDocumentStub, mockDocument, { preview: false });

      sinon.assert.notCalled(setFlinkDocumentMetadataStub);
    });

    it("should open a single statement with metadata context", async function () {
      const metadataContext: WorkspaceMetadataContext = {
        catalog: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      };

      openTextDocumentStub.resolves(mockDocument);
      setFlinkDocumentMetadataStub.resolves();

      await openSqlStatementsAsDocuments([statement], metadataContext);

      sinon.assert.calledOnce(openTextDocumentStub);
      sinon.assert.calledWith(openTextDocumentStub, {
        language: FLINK_SQL_LANGUAGE_ID,
        content: statement,
      });

      sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
      sinon.assert.calledWith(setFlinkDocumentMetadataStub, mockDocument.uri, metadataContext);

      sinon.assert.calledOnce(showTextDocumentStub);
      sinon.assert.calledWith(showTextDocumentStub, mockDocument, { preview: false });
    });

    it("should open multiple statements as separate documents", async function () {
      const statements = [
        "SELECT * FROM table1",
        "SELECT * FROM table2",
        "INSERT INTO table3 SELECT * FROM table4",
      ];

      const mockDocuments = statements.map((s) => createMockDocument(s));

      openTextDocumentStub.onFirstCall().resolves(mockDocuments[0]);
      openTextDocumentStub.onSecondCall().resolves(mockDocuments[1]);
      openTextDocumentStub.onThirdCall().resolves(mockDocuments[2]);

      await openSqlStatementsAsDocuments(statements);

      sinon.assert.callCount(openTextDocumentStub, 3);
      sinon.assert.callCount(showTextDocumentStub, 3);

      for (let i = 0; i < statements.length; i++) {
        sinon.assert.calledWith(openTextDocumentStub.getCall(i), {
          language: FLINK_SQL_LANGUAGE_ID,
          content: statements[i],
        });
        sinon.assert.calledWith(showTextDocumentStub.getCall(i), mockDocuments[i], {
          preview: false,
        });
      }

      sinon.assert.notCalled(setFlinkDocumentMetadataStub);
    });

    it("should set metadata on each document when metadata context is provided", async function () {
      const statements = ["SELECT 1", "SELECT 2"];
      const mockDocuments = statements.map((s) => createMockDocument(s));
      const metadataContext: WorkspaceMetadataContext = {
        catalog: TEST_CCLOUD_ENVIRONMENT,
      };

      openTextDocumentStub.onFirstCall().resolves(mockDocuments[0]);
      openTextDocumentStub.onSecondCall().resolves(mockDocuments[1]);

      setFlinkDocumentMetadataStub.resolves();

      await openSqlStatementsAsDocuments(statements, metadataContext);

      sinon.assert.callCount(setFlinkDocumentMetadataStub, 2);
      sinon.assert.calledWith(
        setFlinkDocumentMetadataStub.getCall(0),
        mockDocuments[0].uri,
        metadataContext,
      );
      sinon.assert.calledWith(
        setFlinkDocumentMetadataStub.getCall(1),
        mockDocuments[1].uri,
        metadataContext,
      );
      sinon.assert.callOrder(setFlinkDocumentMetadataStub, showTextDocumentStub);
    });

    it("should handle partial metadata context", async function () {
      const metadataContext: WorkspaceMetadataContext = {
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      };

      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves();
      setFlinkDocumentMetadataStub.resolves();

      await openSqlStatementsAsDocuments([statement], metadataContext);

      sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
      sinon.assert.calledWith(setFlinkDocumentMetadataStub, mockDocument.uri, metadataContext);
    });

    it("should handle empty metadata context", async function () {
      const metadataContext: WorkspaceMetadataContext = {};

      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves();
      setFlinkDocumentMetadataStub.resolves();

      await openSqlStatementsAsDocuments([statement], metadataContext);

      // Empty metadata context is still truthy, so setFlinkDocumentMetadata should be called
      sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
      sinon.assert.calledWith(setFlinkDocumentMetadataStub, mockDocument.uri, metadataContext);
    });
  });

  describe("selectSqlStatementsForOpening()", function () {
    let createEnhancedQuickPickStub: sinon.SinonStub;

    beforeEach(() => {
      createEnhancedQuickPickStub = sandbox.stub(quickPickUtils, "createEnhancedQuickPick");
    });

    it("should return undefined when user selects no statements", async function () {
      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [],
      });

      const statements: ExtractedSqlStatement[] = [{ statement: "SELECT 1" }];
      const result = await selectSqlStatementsForOpening(statements);

      sinon.assert.match(result, undefined);
    });

    it("should return all statement strings when user keeps all selected", async function () {
      const statements: ExtractedSqlStatement[] = [
        { statement: "SELECT * FROM table1" },
        { statement: "SELECT * FROM table2" },
      ];

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [
          { label: "Cell 1:", value: "SELECT * FROM table1" },
          { label: "Cell 2:", value: "SELECT * FROM table2" },
        ],
      });

      const result = await selectSqlStatementsForOpening(statements);

      sinon.assert.match(result, ["SELECT * FROM table1", "SELECT * FROM table2"]);
    });

    it("should return only selected statement strings when user deselects some", async function () {
      const statements: ExtractedSqlStatement[] = [
        { statement: "SELECT 1" },
        { statement: "SELECT 2" },
        { statement: "SELECT 3" },
      ];

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [{ label: "Cell 2:", value: "SELECT 2" }],
      });

      const result = await selectSqlStatementsForOpening(statements);

      sinon.assert.match(result, ["SELECT 2"]);
    });

    it("should format quick pick items with labels and normalized descriptions", async function () {
      const statements: ExtractedSqlStatement[] = [
        { statement: "SELECT *\n  FROM\n    my_table" },
        { statement: "INSERT INTO target SELECT * FROM source" },
      ];

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [],
      });

      await selectSqlStatementsForOpening(statements);

      sinon.assert.calledOnce(createEnhancedQuickPickStub);

      const items = createEnhancedQuickPickStub.firstCall.args[0];
      sinon.assert.match(items.length, 2);

      // First item: multiline statement gets whitespace normalized in description
      sinon.assert.match(items[0].label, "Cell 1:");
      sinon.assert.match(items[0].description, "SELECT * FROM my_table");
      sinon.assert.match(items[0].value, "SELECT *\n  FROM\n    my_table");

      // Second item
      sinon.assert.match(items[1].label, "Cell 2:");
      sinon.assert.match(items[1].description, "INSERT INTO target SELECT * FROM source");
      sinon.assert.match(items[1].value, "INSERT INTO target SELECT * FROM source");
    });

    it("should pass correct options to createEnhancedQuickPick", async function () {
      const statements: ExtractedSqlStatement[] = [{ statement: "SELECT 1" }];

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [],
      });

      await selectSqlStatementsForOpening(statements);

      sinon.assert.calledOnce(createEnhancedQuickPickStub);

      const options = createEnhancedQuickPickStub.firstCall.args[1];
      sinon.assert.match(options.title, "Select Flink SQL Statements to Open");
      sinon.assert.match(options.canSelectMany, true);
      sinon.assert.match(options.ignoreFocusOut, true);
      sinon.assert.match(options.matchOnDescription, true);
      sinon.assert.match(options.matchOnDetail, true);
    });

    it("should pre-select all items by default", async function () {
      const statements: ExtractedSqlStatement[] = [
        { statement: "SELECT 1" },
        { statement: "SELECT 2" },
      ];

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [],
      });

      await selectSqlStatementsForOpening(statements);

      const items = createEnhancedQuickPickStub.firstCall.args[0];
      const options = createEnhancedQuickPickStub.firstCall.args[1];

      // selectedItems should match all items (pre-selected)
      sinon.assert.match(options.selectedItems, items);
    });
  });

  describe("extractSqlStatementsFromWorkspace()", function () {
    function createMockWorkspace(
      blocks?: GetWsV1Workspace200Response["spec"]["blocks"],
    ): GetWsV1Workspace200Response {
      return {
        spec: {
          blocks,
        },
      } as GetWsV1Workspace200Response;
    }

    it("should return empty array when workspace has no blocks", function () {
      const workspace = createMockWorkspace(undefined);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result, []);
    });

    it("should return empty array when blocks is an empty array", function () {
      const workspace = createMockWorkspace([]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result, []);
    });

    it("should skip blocks with no code_options", function () {
      const workspace = createMockWorkspace([
        { properties: { content: "Some text" } },
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT 1");
    });

    it("should skip blocks with empty source array", function () {
      const workspace = createMockWorkspace([
        { type: WsV1BlockTypeEnum.Code, code_options: { source: [] } },
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2"] } },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT 2");
    });

    it("should skip blocks with only whitespace content", function () {
      const workspace = createMockWorkspace([
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["   ", "\t", "\n"] } },
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT 1");
    });

    it("should extract a single SQL statement", function () {
      const workspace = createMockWorkspace([
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT * FROM my_table"] } },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT * FROM my_table");
      sinon.assert.match(result[0].description, undefined);
    });

    it("should join multiline source arrays with newlines", function () {
      const workspace = createMockWorkspace([
        {
          type: WsV1BlockTypeEnum.Code,
          code_options: {
            source: ["SELECT *", "FROM my_table", "WHERE id = 1"],
          },
        },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT *\nFROM my_table\nWHERE id = 1");
    });

    it("should extract multiple SQL statements from multiple blocks", function () {
      const workspace = createMockWorkspace([
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2"] } },
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 3"] } },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 3);
      sinon.assert.match(result[0].statement, "SELECT 1");
      sinon.assert.match(result[1].statement, "SELECT 2");
      sinon.assert.match(result[2].statement, "SELECT 3");
    });

    it("should include description from block properties", function () {
      const workspace = createMockWorkspace([
        {
          type: WsV1BlockTypeEnum.Code,
          code_options: { source: ["SELECT * FROM orders"] },
          properties: { description: "Query all orders" },
        },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT * FROM orders");
      sinon.assert.match(result[0].description, "Query all orders");
    });

    it("should handle blocks with and without descriptions", function () {
      const workspace = createMockWorkspace([
        {
          type: WsV1BlockTypeEnum.Code,
          code_options: { source: ["SELECT 1"] },
          properties: { description: "First query" },
        },
        {
          type: WsV1BlockTypeEnum.Code,
          code_options: { source: ["SELECT 2"] },
        },
        {
          type: WsV1BlockTypeEnum.Code,
          code_options: { source: ["SELECT 3"] },
          properties: { description: "Third query" },
        },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 3);
      sinon.assert.match(result[0].description, "First query");
      sinon.assert.match(result[1].description, undefined);
      sinon.assert.match(result[2].description, "Third query");
    });

    it("should handle mixed block types (skip non-code blocks without source)", function () {
      const workspace = createMockWorkspace([
        { properties: { content: "Some markdown text" } },
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
        { properties: {} },
        { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2"] } },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 2);
      sinon.assert.match(result[0].statement, "SELECT 1");
      sinon.assert.match(result[1].statement, "SELECT 2");
    });

    it("should preserve whitespace within SQL statements", function () {
      const workspace = createMockWorkspace([
        {
          type: WsV1BlockTypeEnum.Code,
          code_options: {
            source: ["SELECT", "    column1,", "    column2", "FROM table1"],
          },
        },
      ]);

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT\n    column1,\n    column2\nFROM table1");
    });
  });
});
