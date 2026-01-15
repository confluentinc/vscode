import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources/environments";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../tests/unit/testResources/kafkaCluster";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import type { GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import {
  GetWsV1Workspace200ResponseApiVersionEnum,
  GetWsV1Workspace200ResponseKindEnum,
  WsV1BlockTypeEnum,
} from "../clients/flinkWorkspaces";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";
import { extractSqlStatementsFromWorkspace, openSqlStatementsAsDocuments } from "./flinkWorkspace";
import * as statementUtils from "./statementUtils";

/** Creates a minimal valid workspace response for testing. */
function createTestWorkspace(
  overrides: Partial<GetWsV1Workspace200Response> = {},
): GetWsV1Workspace200Response {
  return {
    api_version: GetWsV1Workspace200ResponseApiVersionEnum.WsV1,
    kind: GetWsV1Workspace200ResponseKindEnum.Workspace,
    metadata: {},
    name: "test-workspace",
    spec: {
      display_name: "Test Workspace",
      blocks: [],
      ...overrides.spec,
    },
    ...overrides,
  };
}

describe("flinkSql/flinkWorkspace.ts", function () {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("extractSqlStatementsFromWorkspace", function () {
    it("should return empty array when workspace has no blocks", function () {
      const workspace = createTestWorkspace({
        spec: { display_name: "Test", blocks: undefined },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, []);
    });

    it("should return empty array when blocks is not an array", function () {
      const workspace = createTestWorkspace();
      // Force blocks to be a non-array value
      (workspace.spec as { blocks: unknown }).blocks = "not-an-array";

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, []);
    });

    it("should return empty array when blocks is an empty array", function () {
      const workspace = createTestWorkspace({
        spec: { display_name: "Test", blocks: [] },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, []);
    });

    it("should skip blocks without code_options", function () {
      const workspace = createTestWorkspace({
        spec: {
          display_name: "Test",
          blocks: [{ type: WsV1BlockTypeEnum.Code, properties: {} }],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, []);
    });

    it("should skip blocks with empty code_options.source array", function () {
      const workspace = createTestWorkspace({
        spec: {
          display_name: "Test",
          blocks: [{ type: WsV1BlockTypeEnum.Code, code_options: { source: [] } }],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, []);
    });

    it("should skip blocks with whitespace-only SQL", function () {
      const workspace = createTestWorkspace({
        spec: {
          display_name: "Test",
          blocks: [{ type: WsV1BlockTypeEnum.Code, code_options: { source: ["   ", "\t", "\n"] } }],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, []);
    });

    it("should extract single SQL statement from one block", function () {
      const workspace = createTestWorkspace({
        spec: {
          display_name: "Test",
          blocks: [
            {
              type: WsV1BlockTypeEnum.Code,
              code_options: { source: ["SELECT * FROM users;"] },
            },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, ["SELECT * FROM users;"]);
    });

    it("should join multi-line SQL with newlines", function () {
      const workspace = createTestWorkspace({
        spec: {
          display_name: "Test",
          blocks: [
            {
              type: WsV1BlockTypeEnum.Code,
              code_options: {
                source: ["SELECT", "  id,", "  name", "FROM users;"],
              },
            },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, ["SELECT\n  id,\n  name\nFROM users;"]);
    });

    it("should extract multiple SQL statements from multiple blocks", function () {
      const workspace = createTestWorkspace({
        spec: {
          display_name: "Test",
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT * FROM users;"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT * FROM orders;"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT * FROM products;"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, [
        "SELECT * FROM users;",
        "SELECT * FROM orders;",
        "SELECT * FROM products;",
      ]);
    });

    it("should skip invalid blocks while extracting valid ones", function () {
      const workspace = createTestWorkspace({
        spec: {
          display_name: "Test",
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1;"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: [] } }, // empty source
            { type: WsV1BlockTypeEnum.Code }, // no code_options
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["   "] } }, // whitespace only
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2;"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      assert.deepStrictEqual(result, ["SELECT 1;", "SELECT 2;"]);
    });
  });

  describe("openSqlStatementsAsDocuments", function () {
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let setFlinkDocumentMetadataStub: sinon.SinonStub;

    beforeEach(function () {
      openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
      showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
      setFlinkDocumentMetadataStub = sandbox.stub(statementUtils, "setFlinkDocumentMetadata");
    });

    it("should open a single SQL statement as a document", async function () {
      const mockUri = vscode.Uri.parse("untitled:Untitled-1");
      const mockDocument = { uri: mockUri };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves({});

      await openSqlStatementsAsDocuments(["SELECT * FROM users;"]);

      sinon.assert.calledOnce(openTextDocumentStub);
      sinon.assert.calledWithExactly(openTextDocumentStub, {
        language: FLINK_SQL_LANGUAGE_ID,
        content: "SELECT * FROM users;",
      });
      sinon.assert.calledOnce(showTextDocumentStub);
      sinon.assert.calledWithExactly(showTextDocumentStub, mockDocument, { preview: false });
    });

    it("should open multiple SQL statements as separate documents", async function () {
      const mockDocuments = [
        { uri: vscode.Uri.parse("untitled:Untitled-1") },
        { uri: vscode.Uri.parse("untitled:Untitled-2") },
        { uri: vscode.Uri.parse("untitled:Untitled-3") },
      ];
      openTextDocumentStub
        .onFirstCall()
        .resolves(mockDocuments[0])
        .onSecondCall()
        .resolves(mockDocuments[1])
        .onThirdCall()
        .resolves(mockDocuments[2]);
      showTextDocumentStub.resolves({});

      await openSqlStatementsAsDocuments([
        "SELECT * FROM users;",
        "SELECT * FROM orders;",
        "SELECT * FROM products;",
      ]);

      assert.strictEqual(openTextDocumentStub.callCount, 3);
      assert.strictEqual(showTextDocumentStub.callCount, 3);

      // Verify each document was opened with correct content
      sinon.assert.calledWithExactly(openTextDocumentStub.firstCall, {
        language: FLINK_SQL_LANGUAGE_ID,
        content: "SELECT * FROM users;",
      });
      sinon.assert.calledWithExactly(openTextDocumentStub.secondCall, {
        language: FLINK_SQL_LANGUAGE_ID,
        content: "SELECT * FROM orders;",
      });
      sinon.assert.calledWithExactly(openTextDocumentStub.thirdCall, {
        language: FLINK_SQL_LANGUAGE_ID,
        content: "SELECT * FROM products;",
      });
    });

    it("should not call setFlinkDocumentMetadata when metadataContext is undefined", async function () {
      const mockDocument = { uri: vscode.Uri.parse("untitled:Untitled-1") };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves({});

      await openSqlStatementsAsDocuments(["SELECT 1;"]);

      sinon.assert.notCalled(setFlinkDocumentMetadataStub);
    });

    it("should call setFlinkDocumentMetadata with catalog when provided", async function () {
      const mockUri = vscode.Uri.parse("untitled:Untitled-1");
      const mockDocument = { uri: mockUri };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves({});
      setFlinkDocumentMetadataStub.resolves();

      await openSqlStatementsAsDocuments(["SELECT 1;"], {
        catalog: TEST_CCLOUD_ENVIRONMENT,
      });

      sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
      sinon.assert.calledWithExactly(setFlinkDocumentMetadataStub, mockUri, {
        catalog: TEST_CCLOUD_ENVIRONMENT,
      });
    });

    it("should call setFlinkDocumentMetadata with full metadata context", async function () {
      const mockUri = vscode.Uri.parse("untitled:Untitled-1");
      const mockDocument = { uri: mockUri };
      openTextDocumentStub.resolves(mockDocument);
      showTextDocumentStub.resolves({});
      setFlinkDocumentMetadataStub.resolves();

      const metadataContext = {
        catalog: TEST_CCLOUD_ENVIRONMENT,
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      };

      await openSqlStatementsAsDocuments(["SELECT 1;"], metadataContext);

      sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
      sinon.assert.calledWithExactly(setFlinkDocumentMetadataStub, mockUri, metadataContext);
    });

    it("should set metadata on each document when opening multiple statements", async function () {
      const mockDocuments = [
        { uri: vscode.Uri.parse("untitled:Untitled-1") },
        { uri: vscode.Uri.parse("untitled:Untitled-2") },
      ];
      openTextDocumentStub
        .onFirstCall()
        .resolves(mockDocuments[0])
        .onSecondCall()
        .resolves(mockDocuments[1]);
      showTextDocumentStub.resolves({});
      setFlinkDocumentMetadataStub.resolves();

      const metadataContext = { catalog: TEST_CCLOUD_ENVIRONMENT };

      await openSqlStatementsAsDocuments(["SELECT 1;", "SELECT 2;"], metadataContext);

      assert.strictEqual(setFlinkDocumentMetadataStub.callCount, 2);
      sinon.assert.calledWithExactly(
        setFlinkDocumentMetadataStub.firstCall,
        mockDocuments[0].uri,
        metadataContext,
      );
      sinon.assert.calledWithExactly(
        setFlinkDocumentMetadataStub.secondCall,
        mockDocuments[1].uri,
        metadataContext,
      );
    });

    it("should handle empty SQL statements array", async function () {
      await openSqlStatementsAsDocuments([]);

      sinon.assert.notCalled(openTextDocumentStub);
      sinon.assert.notCalled(showTextDocumentStub);
      sinon.assert.notCalled(setFlinkDocumentMetadataStub);
    });
  });
});
