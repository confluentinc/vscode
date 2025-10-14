import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getSidecarStub } from "../../../tests/stubs/sidecar";
import { StubbedWebviewPanel } from "../../../tests/stubs/webviews";
import { StubbedWorkspaceConfiguration } from "../../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { STATEMENT_RESULTS_LOCATION } from "../../extensionSettings/constants";
import * as resultManager from "../../flinkSql/flinkStatementResultsManager";
import { FlinkStatementWebviewPanelCache } from "../../flinkSql/statementUtils";
import { FlinkStatementResultsPanelProvider } from "../../panelProviders/flinkStatementResults";
import { confirmActionOnStatement, openFlinkStatementResultsView } from "./statements";

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

    let getPanelForStatementStub: sinon.SinonStub;
    let stubbedPanelProvider: sinon.SinonStubbedInstance<FlinkStatementResultsPanelProvider>;
    let stubbedFlinkStatementResultsManager: sinon.SinonStubbedInstance<resultManager.FlinkStatementResultsManager>;

    beforeEach(() => {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);

      // openFlinkStatementResultsInEditor() dependencies
      getPanelForStatementStub = sandbox.stub(
        FlinkStatementWebviewPanelCache.prototype,
        "getPanelForStatement",
      );
      getSidecarStub(sandbox); // no need to actually assert anything with the sidecar here
      stubbedFlinkStatementResultsManager = sandbox.createStubInstance(
        resultManager.FlinkStatementResultsManager,
      );
      sandbox
        .stub(resultManager, "FlinkStatementResultsManager")
        .callsFake(() => stubbedFlinkStatementResultsManager);

      // openFlinkStatementResultsInPanel() dependencies
      stubbedPanelProvider = sandbox.createStubInstance(FlinkStatementResultsPanelProvider);
      sandbox.stub(FlinkStatementResultsPanelProvider, "getInstance").returns(stubbedPanelProvider);
    });

    it("should exit early if statement is undefined", async () => {
      await openFlinkStatementResultsView(undefined);

      // openFlinkStatementResultsInEditor isn't called, so the panel cache isn't accessed
      sinon.assert.notCalled(getPanelForStatementStub);
      // openFlinkStatementResultsInPanel isn't called, so the panel provider isn't accessed
      sinon.assert.notCalled(stubbedPanelProvider.showStatementResults);
    });

    it("should exit early if statement is not a FlinkStatement", async () => {
      // passing a plain object instead of a FlinkStatement instance
      await openFlinkStatementResultsView({} as any);

      // openFlinkStatementResultsInEditor isn't called, so the panel cache isn't accessed
      sinon.assert.notCalled(getPanelForStatementStub);
      // openFlinkStatementResultsInPanel isn't called, so the panel provider isn't accessed
      sinon.assert.notCalled(stubbedPanelProvider.showStatementResults);
    });

    it(`should call into openFlinkStatementResultsInEditor when "${STATEMENT_RESULTS_LOCATION.id}" is 'editor'`, async () => {
      stubbedConfigs.stubGet(STATEMENT_RESULTS_LOCATION, "editor");
      const stubbedWebviewPanel = new StubbedWebviewPanel(sandbox);
      getPanelForStatementStub.returns([stubbedWebviewPanel, false]);

      await openFlinkStatementResultsView(TEST_CCLOUD_FLINK_STATEMENT);

      // openFlinkStatementResultsInEditor is called, so the panel cache is accessed
      sinon.assert.calledOnce(getPanelForStatementStub);
      sinon.assert.calledOnceWithExactly(getPanelForStatementStub, TEST_CCLOUD_FLINK_STATEMENT);
      // openFlinkStatementResultsInPanel isn't called, so the panel provider isn't accessed
      sinon.assert.notCalled(stubbedPanelProvider.showStatementResults);
    });

    it(`should call into openFlinkStatementResultsInPanel when "${STATEMENT_RESULTS_LOCATION.id}" is 'panel'`, async () => {
      stubbedConfigs.stubGet(STATEMENT_RESULTS_LOCATION, "panel");

      await openFlinkStatementResultsView(TEST_CCLOUD_FLINK_STATEMENT);

      // openFlinkStatementResultsInEditor isn't called, so the panel cache isn't accessed
      sinon.assert.notCalled(getPanelForStatementStub);
      // openFlinkStatementResultsInPanel is called, so the panel provider is accessed
      sinon.assert.calledOnce(stubbedPanelProvider.showStatementResults);
      sinon.assert.calledOnceWithExactly(
        stubbedPanelProvider.showStatementResults,
        TEST_CCLOUD_FLINK_STATEMENT,
      );
    });
  });

  describe("openFlinkStatementResultsInEditor", () => {
    let getPanelForStatementStub: sinon.SinonStub;

    beforeEach(() => {
      getPanelForStatementStub = sandbox.stub(
        FlinkStatementWebviewPanelCache.prototype,
        "getPanelForStatement",
      );
    });

    it("should reveal an existing panel from the cache if one exists for the statement", async () => {
      const stubbedWebviewPanel = new StubbedWebviewPanel(sandbox);
      getPanelForStatementStub.returns([stubbedWebviewPanel, true]);

      await openFlinkStatementResultsView(TEST_CCLOUD_FLINK_STATEMENT);

      sinon.assert.calledOnce(getPanelForStatementStub);
      sinon.assert.calledOnceWithExactly(getPanelForStatementStub, TEST_CCLOUD_FLINK_STATEMENT);
      sinon.assert.calledOnce(stubbedWebviewPanel.reveal);
    });

    // not testing for the case where no existing panel is found, because that is already covered
    // by the openFlinkStatementResultsView() tests
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
