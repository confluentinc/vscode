import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";
import type { WorkspaceMetadataContext } from "./flinkWorkspace";
import { openSqlStatementsAsDocuments } from "./flinkWorkspace";
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
});
