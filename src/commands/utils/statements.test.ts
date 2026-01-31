import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { StubbedWorkspaceConfiguration } from "../../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { STATEMENT_RESULTS_LOCATION } from "../../extensionSettings/constants";
import * as flinkSqlApiProviderModule from "../../flinkSql/flinkSqlApiProvider";
import type { FlinkSqlApiProvider } from "../../flinkSql/flinkStatementResultsManager";
import { FlinkStatementResultsPanelProvider } from "../../panelProviders/flinkStatementResults";
import * as webviewCommsModule from "../../webview/comms/comms";
import {
  confirmActionOnStatement,
  openFlinkStatementResultsView,
  statementResultsViewCache,
} from "./statements";

describe("src/commands/utils/statements.ts", () => {
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

  describe("openFlinkStatementResultsView", () => {
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let stubbedPanelProvider: sinon.SinonStubbedInstance<FlinkStatementResultsPanelProvider>;

    beforeEach(() => {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);

      // openFlinkStatementResultsInPanel() dependencies
      stubbedPanelProvider = sandbox.createStubInstance(FlinkStatementResultsPanelProvider);
      sandbox.stub(FlinkStatementResultsPanelProvider, "getInstance").returns(stubbedPanelProvider);
    });

    it("should exit early if statement is undefined", async () => {
      await openFlinkStatementResultsView(undefined);

      // openFlinkStatementResultsInPanel isn't called, so the panel provider isn't accessed
      sinon.assert.notCalled(stubbedPanelProvider.showStatementResults);
    });

    it("should exit early if statement is not a FlinkStatement", async () => {
      // passing a plain object instead of a FlinkStatement instance
      await openFlinkStatementResultsView({} as any);

      // openFlinkStatementResultsInPanel isn't called, so the panel provider isn't accessed
      sinon.assert.notCalled(stubbedPanelProvider.showStatementResults);
    });

    it(`should call into openFlinkStatementResultsInEditor when "${STATEMENT_RESULTS_LOCATION.id}" is 'editor'`, async () => {
      stubbedConfigs.stubGet(STATEMENT_RESULTS_LOCATION, "editor");

      // Mock the panel returned by statementResultsViewCache
      const mockWebview = {
        postMessage: sandbox.stub().resolves(),
        onDidReceiveMessage: sandbox.stub(),
      };
      const revealStub = sandbox.stub();
      const mockPanel = {
        webview: mockWebview,
        reveal: revealStub,
        onDidDispose: sandbox.stub(),
      } as unknown as vscode.WebviewPanel;
      const getPanelForStatementStub = sandbox
        .stub(statementResultsViewCache, "getPanelForStatement")
        .returns([mockPanel, true]); // isNew = true

      // Mock getFlinkSqlApiProvider
      const mockFlinkApiProvider: FlinkSqlApiProvider = {
        getFlinkSqlStatementResultsApi: sandbox.stub().returns({} as any),
        getFlinkSqlStatementsApi: sandbox.stub().returns({} as any),
      };
      sandbox
        .stub(flinkSqlApiProviderModule, "getFlinkSqlApiProvider")
        .returns(mockFlinkApiProvider);

      // Mock handleWebviewMessage to return a disposable
      const mockMessageHandler = { dispose: sandbox.stub() };
      sandbox.stub(webviewCommsModule, "handleWebviewMessage").returns(mockMessageHandler);

      await openFlinkStatementResultsView(TEST_CCLOUD_FLINK_STATEMENT);

      // Verify the panel was fetched/created
      sinon.assert.calledOnce(getPanelForStatementStub);
      sinon.assert.calledWithExactly(getPanelForStatementStub, TEST_CCLOUD_FLINK_STATEMENT);

      // Verify the panel was revealed (since isNew = true)
      sinon.assert.calledOnce(revealStub);
      sinon.assert.calledWithExactly(revealStub, vscode.ViewColumn.One);

      // Verify the panel provider (for panel mode) was NOT accessed
      sinon.assert.notCalled(stubbedPanelProvider.showStatementResults);
    });

    it(`should call into openFlinkStatementResultsInPanel when "${STATEMENT_RESULTS_LOCATION.id}" is 'panel'`, async () => {
      stubbedConfigs.stubGet(STATEMENT_RESULTS_LOCATION, "panel");

      await openFlinkStatementResultsView(TEST_CCLOUD_FLINK_STATEMENT);

      // openFlinkStatementResultsInPanel is called, so the panel provider is accessed
      sinon.assert.calledOnce(stubbedPanelProvider.showStatementResults);
      sinon.assert.calledOnceWithExactly(
        stubbedPanelProvider.showStatementResults,
        TEST_CCLOUD_FLINK_STATEMENT,
      );
    });
  });

  describe("openFlinkStatementResultsInEditor", () => {
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let getPanelForStatementStub: sinon.SinonStub;
    let getFlinkSqlApiProviderStub: sinon.SinonStub;
    let handleWebviewMessageStub: sinon.SinonStub;
    let mockPanel: vscode.WebviewPanel;
    let mockWebview: { postMessage: sinon.SinonStub; onDidReceiveMessage: sinon.SinonStub };
    let mockFlinkApiProvider: FlinkSqlApiProvider;
    let mockMessageHandler: { dispose: sinon.SinonStub };
    let revealStub: sinon.SinonStub;

    beforeEach(() => {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
      stubbedConfigs.stubGet(STATEMENT_RESULTS_LOCATION, "editor");

      // Mock the webview and panel
      mockWebview = {
        postMessage: sandbox.stub().resolves(),
        onDidReceiveMessage: sandbox.stub(),
      };
      revealStub = sandbox.stub();
      mockPanel = {
        webview: mockWebview,
        reveal: revealStub,
        onDidDispose: sandbox.stub(),
      } as unknown as vscode.WebviewPanel;
      getPanelForStatementStub = sandbox.stub(statementResultsViewCache, "getPanelForStatement");

      // Mock getFlinkSqlApiProvider
      mockFlinkApiProvider = {
        getFlinkSqlStatementResultsApi: sandbox.stub().returns({} as any),
        getFlinkSqlStatementsApi: sandbox.stub().returns({} as any),
      };
      getFlinkSqlApiProviderStub = sandbox
        .stub(flinkSqlApiProviderModule, "getFlinkSqlApiProvider")
        .returns(mockFlinkApiProvider);

      // Mock handleWebviewMessage to return a disposable
      mockMessageHandler = { dispose: sandbox.stub() };
      handleWebviewMessageStub = sandbox
        .stub(webviewCommsModule, "handleWebviewMessage")
        .returns(mockMessageHandler);
    });

    it("should reveal an existing panel if found in cache", async () => {
      // Return an existing panel (isNew = false)
      getPanelForStatementStub.returns([mockPanel, false]);

      await openFlinkStatementResultsView(TEST_CCLOUD_FLINK_STATEMENT);

      // Verify the panel was fetched
      sinon.assert.calledOnce(getPanelForStatementStub);

      // Verify reveal was NOT called (isNew = false)
      sinon.assert.notCalled(revealStub);

      // Verify FlinkSqlApiProvider was still called (to set up results manager)
      sinon.assert.calledOnce(getFlinkSqlApiProviderStub);
    });

    it("should create a new panel and reveal it if not in cache", async () => {
      // Return a new panel (isNew = true)
      getPanelForStatementStub.returns([mockPanel, true]);

      await openFlinkStatementResultsView(TEST_CCLOUD_FLINK_STATEMENT);

      // Verify the panel was fetched
      sinon.assert.calledOnce(getPanelForStatementStub);

      // Verify reveal was called (isNew = true)
      sinon.assert.calledOnce(revealStub);
      sinon.assert.calledWithExactly(revealStub, vscode.ViewColumn.One);

      // Verify message handler was set up
      sinon.assert.calledOnce(handleWebviewMessageStub);
    });
  });

  describe("confirmActionOnStatement", () => {
    let showWarningMessageStub: sinon.SinonStub;
    const statement = TEST_CCLOUD_FLINK_STATEMENT;

    beforeEach(() => {
      showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage");
    });

    interface ConfirmActionTestCase {
      action: "stop" | "delete";
      resolution: string | undefined;
      expected: boolean;
      description: string;
    }

    const cases: ConfirmActionTestCase[] = [
      {
        action: "stop",
        resolution: "Stop Statement",
        expected: true,
        description: "confirm stop action (user chooses Stop Statement)",
      },
      {
        action: "stop",
        resolution: undefined,
        expected: false,
        description: "cancel stop action (user dismisses prompt)",
      },
      {
        action: "delete",
        resolution: "Delete Statement",
        expected: true,
        description: "confirm delete action (user chooses Delete Statement)",
      },
      {
        action: "delete",
        resolution: undefined,
        expected: false,
        description: "cancel delete action (user dismisses prompt)",
      },
    ];

    for (const { action, resolution, expected, description } of cases) {
      it(`should ${description}`, async () => {
        showWarningMessageStub.resetHistory();
        showWarningMessageStub.resolves(resolution);

        const result = await confirmActionOnStatement(action, statement);

        sinon.assert.calledOnce(showWarningMessageStub);
        assert.strictEqual(result, expected);
      });
    }
  });
});
