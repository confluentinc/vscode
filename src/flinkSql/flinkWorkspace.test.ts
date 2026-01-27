import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import {
  TEST_CCLOUD_FLINK_COMPUTE_POOL,
  TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
} from "../../tests/unit/testResources/flinkComputePool";
import {
  GetWsV1Workspace200ResponseApiVersionEnum,
  GetWsV1Workspace200ResponseKindEnum,
  WsV1BlockTypeEnum,
  type GetWsV1Workspace200Response,
} from "../clients/flinkWorkspaces";
import type { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import * as notifications from "../notifications";
import * as quickPickUtils from "../quickpicks/utils/quickPickUtils";
import { FLINK_SQL_LANGUAGE_ID } from "./constants";
import type { ExtractedSqlStatement, WorkspaceMetadataContext } from "./flinkWorkspace";
import {
  extractMetadataFromWorkspace,
  extractSqlStatementsFromWorkspace,
  extractWorkspaceParamsFromUri,
  FlinkWorkspaceUriError,
  handleFlinkWorkspaceUriEvent,
  openSqlStatementsAsDocuments,
  selectSqlStatementsForOpening,
} from "./flinkWorkspace";
import * as statementUtils from "./statementUtils";

describe("flinkSql/flinkWorkspace.ts", function () {
  let sandbox: sinon.SinonSandbox;
  let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let openTextDocumentStub: sinon.SinonStub;
  let showTextDocumentStub: sinon.SinonStub;
  let setFlinkDocumentMetadataStub: sinon.SinonStub;
  let createEnhancedQuickPickStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    ccloudLoaderStub = getStubbedCCloudResourceLoader(sandbox);
    openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
    showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
    setFlinkDocumentMetadataStub = sandbox.stub(statementUtils, "setFlinkDocumentMetadata");
    createEnhancedQuickPickStub = sandbox.stub(quickPickUtils, "createEnhancedQuickPick");
    showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
  });

  afterEach(() => {
    sandbox.restore();
  });

  function createMockWorkspace(
    overrides: Omit<Partial<GetWsV1Workspace200Response>, "spec"> & {
      spec?: Partial<GetWsV1Workspace200Response["spec"]>;
    } = {},
  ): GetWsV1Workspace200Response {
    return {
      api_version: GetWsV1Workspace200ResponseApiVersionEnum.WsV1,
      kind: GetWsV1Workspace200ResponseKindEnum.Workspace,
      metadata: {},
      name: "test-workspace",
      environment_id: overrides.environment_id,
      spec: {
        display_name: "Test Workspace",
        ...overrides.spec,
      },
    } satisfies GetWsV1Workspace200Response;
  }

  function createMockDocument(content: string): vscode.TextDocument {
    return {
      uri: vscode.Uri.parse(`untitled:${content.substring(0, 10)}`),
      languageId: FLINK_SQL_LANGUAGE_ID,
      getText: () => content,
    } as vscode.TextDocument;
  }

  function createUri(queryParams: Record<string, string>): vscode.Uri {
    const query = new URLSearchParams(queryParams).toString();
    return vscode.Uri.parse(`vscode://confluent.vscode-confluent/flinkWorkspace?${query}`);
  }

  const validParams = {
    environmentId: "env-123",
    organizationId: "org-456",
    workspaceName: "my-workspace",
    provider: "aws",
    region: "us-east-1",
  };

  describe("openSqlStatementsAsDocuments()", function () {
    const statement = "SELECT * FROM my_table";
    const mockDocument = createMockDocument(statement);

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

  describe("extractMetadataFromWorkspace()", function () {
    it("should return empty context when workspace has no environment_id", async function () {
      const workspace = createMockWorkspace({});

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result, {});
    });

    it("should return empty context when environment not found", async function () {
      const workspace = createMockWorkspace({ environment_id: "env-unknown" });

      ccloudLoaderStub.getEnvironments.resolves([]);

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result, {});
    });

    it("should return context with catalog when environment is found", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });

      const workspace = createMockWorkspace({ environment_id: testEnvironment.id });

      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result.catalog, testEnvironment);
      sinon.assert.match(result.computePool, undefined);
      sinon.assert.match(result.database, undefined);
    });

    it("should return context with catalog and computePool when both are found", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: { compute_pool: { id: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID } },
      });

      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result.catalog, testEnvironment);
      sinon.assert.match(result.computePool, TEST_CCLOUD_FLINK_COMPUTE_POOL);
      sinon.assert.match(result.database, undefined);
    });

    it("should return undefined when compute pool not found in environment", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: { compute_pool: { id: "lfcp-unknown" } },
      });

      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result.catalog, testEnvironment);
      sinon.assert.match(result.computePool, undefined);
    });

    it("should return context with database when provided cluster matches existing compute pool", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      });

      // The workspace passes the cluster id matching the existing compute pool,
      // which is also available in the Flink pools array for that cluster by default
      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: { properties: { "sql-database": TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id } },
      });

      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);
      ccloudLoaderStub.getKafkaClustersForEnvironmentId.resolves([
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      ]);

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result.catalog, testEnvironment);
      sinon.assert.match(result.database, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
    });

    it("should not set database in context when provided cluster is not associated with any compute pools", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: { properties: { "sql-database": TEST_CCLOUD_KAFKA_CLUSTER.id } },
      });

      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);
      // This cluster exists but is not linked to any compute pool
      ccloudLoaderStub.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result.catalog, testEnvironment);
      sinon.assert.match(result.database, undefined);
    });

    it("should return full context with catalog, computePool, and database", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: {
          compute_pool: { id: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID },
          properties: { "sql-database": TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id },
        },
      });

      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);
      ccloudLoaderStub.getKafkaClustersForEnvironmentId.resolves([
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      ]);

      const result = await extractMetadataFromWorkspace(workspace);

      sinon.assert.match(result.catalog, testEnvironment);
      sinon.assert.match(result.computePool, TEST_CCLOUD_FLINK_COMPUTE_POOL);
      sinon.assert.match(result.database, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
    });

    it("should not fetch kafka clusters when no database ID in properties", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: { properties: { "other-property": "value" } },
      });

      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);

      await extractMetadataFromWorkspace(workspace);

      sinon.assert.notCalled(ccloudLoaderStub.getKafkaClustersForEnvironmentId);
    });
  });

  describe("extractSqlStatementsFromWorkspace()", function () {
    it("should return empty array when workspace has no blocks", function () {
      const workspace = createMockWorkspace({});

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result, []);
    });

    it("should return empty array when blocks is an empty array", function () {
      const workspace = createMockWorkspace({ spec: { blocks: [] } });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result, []);
    });

    it("should skip blocks with no code_options", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            { properties: { content: "Some text" } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT 1");
    });

    it("should skip blocks with empty source array", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: [] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT 2");
    });

    it("should skip blocks with only whitespace content", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["   ", "\t", "\n"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT 1");
    });

    it("should extract a single SQL statement", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT * FROM my_table"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT * FROM my_table");
      sinon.assert.match(result[0].description, undefined);
    });

    it("should join multiline source arrays with newlines", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            {
              type: WsV1BlockTypeEnum.Code,
              code_options: {
                source: ["SELECT *", "FROM my_table", "WHERE id = 1"],
              },
            },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT *\nFROM my_table\nWHERE id = 1");
    });

    it("should extract multiple SQL statements from multiple blocks", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 3"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 3);
      sinon.assert.match(result[0].statement, "SELECT 1");
      sinon.assert.match(result[1].statement, "SELECT 2");
      sinon.assert.match(result[2].statement, "SELECT 3");
    });

    it("should include description from block properties", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            {
              type: WsV1BlockTypeEnum.Code,
              code_options: { source: ["SELECT * FROM orders"] },
              properties: { description: "Query all orders" },
            },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT * FROM orders");
      sinon.assert.match(result[0].description, "Query all orders");
    });

    it("should handle blocks with and without descriptions", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
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
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 3);
      sinon.assert.match(result[0].description, "First query");
      sinon.assert.match(result[1].description, undefined);
      sinon.assert.match(result[2].description, "Third query");
    });

    it("should handle mixed block types (skip non-code blocks without source)", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            { properties: { content: "Some markdown text" } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
            { properties: {} },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2"] } },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 2);
      sinon.assert.match(result[0].statement, "SELECT 1");
      sinon.assert.match(result[1].statement, "SELECT 2");
    });

    it("should preserve whitespace within SQL statements", function () {
      const workspace = createMockWorkspace({
        spec: {
          blocks: [
            {
              type: WsV1BlockTypeEnum.Code,
              code_options: {
                source: ["SELECT", "    column1,", "    column2", "FROM table1"],
              },
            },
          ],
        },
      });

      const result = extractSqlStatementsFromWorkspace(workspace);

      sinon.assert.match(result.length, 1);
      sinon.assert.match(result[0].statement, "SELECT\n    column1,\n    column2\nFROM table1");
    });
  });

  describe("handleFlinkWorkspaceUriEvent()", function () {
    it("should open placeholder document when workspace blocks contain only whitespace", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: {
          display_name: "Test Workspace",
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["   ", "\t", "\n"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["  \n  \t  "] } },
          ],
        },
      });

      const mockDocument = createMockDocument("No Flink SQL statements");

      ccloudLoaderStub.getFlinkWorkspace.resolves(workspace);
      // This is called from extractMetadataFromWorkspace
      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);
      openTextDocumentStub.resolves(mockDocument);

      await handleFlinkWorkspaceUriEvent(createUri(validParams));

      sinon.assert.calledOnce(openTextDocumentStub);
      const docOptions = openTextDocumentStub.firstCall.args[0];
      assert.strictEqual(docOptions.language, FLINK_SQL_LANGUAGE_ID);
      assert.ok(docOptions.content.includes("No Flink SQL statements were found"));

      sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
      sinon.assert.calledOnce(showTextDocumentStub);
      sinon.assert.notCalled(createEnhancedQuickPickStub);
    });

    it("should extract only valid SQL statements from mixed content blocks", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: {
          display_name: "Test Workspace",
          blocks: [
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["   "] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 2"] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: [] } },
            { type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 3"] } },
          ],
        },
      });

      ccloudLoaderStub.getFlinkWorkspace.resolves(workspace);
      // This is called from extractMetadataFromWorkspace
      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);

      const mockDocuments = [
        createMockDocument("SELECT 1"),
        createMockDocument("SELECT 2"),
        createMockDocument("SELECT 3"),
      ];
      openTextDocumentStub.onFirstCall().resolves(mockDocuments[0]);
      openTextDocumentStub.onSecondCall().resolves(mockDocuments[1]);
      openTextDocumentStub.onThirdCall().resolves(mockDocuments[2]);

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [
          { label: "Cell 1:", value: "SELECT 1" },
          { label: "Cell 2:", value: "SELECT 2" },
          { label: "Cell 3:", value: "SELECT 3" },
        ],
      });

      await handleFlinkWorkspaceUriEvent(createUri(validParams));

      sinon.assert.calledOnce(createEnhancedQuickPickStub);
      const quickPickItems = createEnhancedQuickPickStub.firstCall.args[0];
      assert.strictEqual(quickPickItems.length, 3);
      assert.strictEqual(quickPickItems[0].value, "SELECT 1");
      assert.strictEqual(quickPickItems[1].value, "SELECT 2");
      assert.strictEqual(quickPickItems[2].value, "SELECT 3");

      sinon.assert.callCount(openTextDocumentStub, 3);
    });

    // Duplicate assertions result from being unable to directly stub handleFlinkWorkspaceUriEvent's internal calls
    it("should pass correct metadata context values to setFlinkDocumentMetadata", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: {
          display_name: "Test Workspace",
          compute_pool: { id: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID },
          properties: { "sql-database": TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id },
          blocks: [{ type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } }],
        },
      });

      ccloudLoaderStub.getFlinkWorkspace.resolves(workspace);

      // This is called from extractMetadataFromWorkspace
      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);
      ccloudLoaderStub.getKafkaClustersForEnvironmentId.resolves([
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      ]);

      const mockDocument = createMockDocument("SELECT 1");
      openTextDocumentStub.resolves(mockDocument);

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [{ label: "Cell 1:", value: "SELECT 1" }],
      });

      await handleFlinkWorkspaceUriEvent(createUri(validParams));

      sinon.assert.calledOnce(setFlinkDocumentMetadataStub);
      const metadataContext = setFlinkDocumentMetadataStub.firstCall.args[1];

      assert.strictEqual(metadataContext.catalog, testEnvironment);
      assert.strictEqual(metadataContext.computePool, TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(metadataContext.database, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
    });

    it("should show error notification when opening documents fails", async function () {
      const testEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [],
      });

      const workspace = createMockWorkspace({
        environment_id: testEnvironment.id,
        spec: {
          display_name: "Test Workspace",
          blocks: [{ type: WsV1BlockTypeEnum.Code, code_options: { source: ["SELECT 1"] } }],
        },
      });

      ccloudLoaderStub.getFlinkWorkspace.resolves(workspace);
      ccloudLoaderStub.getEnvironments.resolves([testEnvironment]);

      createEnhancedQuickPickStub.resolves({
        quickPick: { dispose: sandbox.stub() },
        selectedItems: [{ label: "Cell 1:", value: "SELECT 1" }],
      });

      // Should not happen: as we follow straightforward paths for opening documents
      openTextDocumentStub.rejects(new TypeError("Cannot read properties of undefined"));

      await handleFlinkWorkspaceUriEvent(createUri(validParams));

      sinon.assert.calledOnce(showErrorNotificationStub);
      const notificationMessage = showErrorNotificationStub.firstCall.args[0] as string;
      assert.ok(notificationMessage.includes("Failed to open Flink SQL workspace"));
      assert.ok(notificationMessage.includes("Cannot read properties of undefined"));
    });
  });

  describe("extractWorkspaceParamsFromUri()", function () {
    it("should extract all parameters from a valid URI", function () {
      const uri = createUri(validParams);

      const result = extractWorkspaceParamsFromUri(uri);

      assert.strictEqual(result.environmentId, validParams.environmentId);
      assert.strictEqual(result.organizationId, validParams.organizationId);
      assert.strictEqual(result.workspaceName, validParams.workspaceName);
      assert.strictEqual(result.provider, validParams.provider);
      assert.strictEqual(result.region, validParams.region);
    });

    it("should throw FlinkWorkspaceUriError when environmentId is missing", function () {
      const uri = createUri({
        organizationId: validParams.organizationId,
        workspaceName: validParams.workspaceName,
        provider: validParams.provider,
        region: validParams.region,
      });

      assert.throws(() => extractWorkspaceParamsFromUri(uri), FlinkWorkspaceUriError);
    });

    it("should throw FlinkWorkspaceUriError when organizationId is missing", function () {
      const uri = createUri({
        environmentId: validParams.environmentId,
        workspaceName: validParams.workspaceName,
        provider: validParams.provider,
        region: validParams.region,
      });

      assert.throws(() => extractWorkspaceParamsFromUri(uri), FlinkWorkspaceUriError);
    });

    it("should throw FlinkWorkspaceUriError when workspaceName is missing", function () {
      const uri = createUri({
        environmentId: validParams.environmentId,
        organizationId: validParams.organizationId,
        provider: validParams.provider,
        region: validParams.region,
      });

      assert.throws(() => extractWorkspaceParamsFromUri(uri), FlinkWorkspaceUriError);
    });

    it("should throw FlinkWorkspaceUriError when provider is missing", function () {
      const uri = createUri({
        environmentId: validParams.environmentId,
        organizationId: validParams.organizationId,
        workspaceName: validParams.workspaceName,
        region: validParams.region,
      });

      assert.throws(() => extractWorkspaceParamsFromUri(uri), FlinkWorkspaceUriError);
    });

    it("should throw FlinkWorkspaceUriError when region is missing", function () {
      const uri = createUri({
        environmentId: validParams.environmentId,
        organizationId: validParams.organizationId,
        workspaceName: validParams.workspaceName,
        provider: validParams.provider,
      });

      assert.throws(() => extractWorkspaceParamsFromUri(uri), FlinkWorkspaceUriError);
    });

    it("should include all missing params in error when multiple are missing", function () {
      const uri = createUri({
        workspaceName: "my-workspace",
      });

      assert.throws(
        () => extractWorkspaceParamsFromUri(uri),
        new FlinkWorkspaceUriError(["environmentId", "organizationId", "provider", "region"]),
      );
    });

    it("should include all five params in error when none are provided", function () {
      const uri = createUri({});

      assert.throws(
        () => extractWorkspaceParamsFromUri(uri),
        new FlinkWorkspaceUriError([
          "environmentId",
          "organizationId",
          "workspaceName",
          "provider",
          "region",
        ]),
      );
    });

    it("should treat empty string values as missing", function () {
      const uri = createUri({
        ...validParams,
        environmentId: "",
      });

      assert.throws(
        () => extractWorkspaceParamsFromUri(uri),
        new FlinkWorkspaceUriError(["environmentId"]),
      );
    });

    it("should ignore extra parameters in the URI", function () {
      const uri = createUri({
        ...validParams,
        extraParam: "should-be-ignored",
        anotherExtra: "also-ignored",
      });

      const result = extractWorkspaceParamsFromUri(uri);

      assert.strictEqual(result.environmentId, "env-123");
      assert.strictEqual(result.organizationId, "org-456");
      assert.strictEqual(result.workspaceName, "my-workspace");
      assert.strictEqual(result.provider, "aws");
      assert.strictEqual(result.region, "us-east-1");
    });

    it("should handle URL-encoded parameter values", function () {
      const uri = createUri({
        ...validParams,
        workspaceName: "my workspace with spaces",
      });
      // createUri encodes the parameters, so we verify that here
      // might need to expand the function for + vs %20 checks
      assert.ok(uri.query.includes("my+workspace+with+spaces"), uri.query);

      const result = extractWorkspaceParamsFromUri(uri);
      assert.strictEqual(result.workspaceName, "my workspace with spaces");
    });
  });
});
