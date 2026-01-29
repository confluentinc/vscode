import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { StubbedWorkspaceConfiguration } from "../../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { STATEMENT_RESULTS_LOCATION } from "../../extensionSettings/constants";
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

    // TODO(sidecar-removal): Re-enable test after implementing FlinkStatementResultsManager without sidecar
    it.skip(`should call into openFlinkStatementResultsInEditor when "${STATEMENT_RESULTS_LOCATION.id}" is 'editor'`, async () => {
      // This test requires sidecar stub for FlinkStatementResultsManager
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

  // TODO(sidecar-removal): Re-enable openFlinkStatementResultsInEditor tests after implementing without sidecar
  describe("openFlinkStatementResultsInEditor", () => {
    it.skip("tests skipped pending sidecar removal refactor", () => {
      // These tests require sidecar stub for FlinkStatementResultsManager
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
