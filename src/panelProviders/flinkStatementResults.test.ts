import * as assert from "assert";
import * as sinon from "sinon";
import { commands } from "vscode";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { StubbedWebviewView } from "../../tests/stubs/webviews";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as contextValues from "../context/values";
import { Phase } from "../models/flinkStatement";
import { FlinkStatementResultsPanelProvider } from "../panelProviders/flinkStatementResults";

describe("panelProviders/flinkStatementResults.ts", () => {
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

  describe("FlinkStatementResultsPanelProvider", () => {
    let provider: FlinkStatementResultsPanelProvider;
    let stubbedWebviewView: StubbedWebviewView;
    let getStatementResultsHtmlStub: sinon.SinonStub;
    const testStatement = createFlinkStatement({
      name: "test-statement",
      phase: Phase.RUNNING,
    });

    beforeEach(() => {
      provider = FlinkStatementResultsPanelProvider.getInstance();
      provider["currentStatement"] = testStatement;
      // don't actually generate HTML from the template in these tests
      getStatementResultsHtmlStub = sandbox.stub();
      provider["getStatementResultsHtml"] = getStatementResultsHtmlStub;

      stubbedWebviewView = new StubbedWebviewView(sandbox);
    });

    afterEach(() => {
      // prevent any cross-test contamination and event listeners
      provider.dispose();
    });

    describe("getInstance()", () => {
      it("should return a singleton instance", () => {
        const otherProvider = FlinkStatementResultsPanelProvider.getInstance();

        assert.strictEqual(otherProvider, provider);
      });
    });

    describe("resolveWebviewView()", () => {
      let showStatementResultsStub: sinon.SinonStub;

      beforeEach(() => {
        showStatementResultsStub = sandbox.stub(provider, "showStatementResults");
      });

      it("should set webview options", async () => {
        await provider.resolveWebviewView(stubbedWebviewView);

        assert.strictEqual(stubbedWebviewView.webview.options.enableScripts, true);
        assert.ok(Array.isArray(stubbedWebviewView.webview.options.localResourceRoots));
      });

      it("should exit early when currentStatement isn't set", async () => {
        provider["currentStatement"] = undefined;
        // this shouldn't happen because resolveWebviewView won't be called until a statement's
        // results have been requested, but guard against it anyway

        await provider.resolveWebviewView(stubbedWebviewView);

        sinon.assert.notCalled(showStatementResultsStub);
      });

      it("should call showStatementResults() when currentStatement is set", async () => {
        const testStatement = createFlinkStatement({
          name: "test-statement",
          phase: Phase.RUNNING,
        });
        provider["currentStatement"] = testStatement;

        await provider.resolveWebviewView(stubbedWebviewView);

        sinon.assert.calledOnceWithExactly(showStatementResultsStub, testStatement);
      });

      it("should register the webview onDidDispose handler", async () => {
        await provider.resolveWebviewView(stubbedWebviewView);

        sinon.assert.calledOnceWithMatch(stubbedWebviewView.onDidDispose, sinon.match.func);
      });
    });

    describe("showStatementResults()", () => {
      let executeCommandStub: sinon.SinonStub;
      let setContextValueStub: sinon.SinonStub;

      beforeEach(async () => {
        getSidecarStub(sandbox); // no assertions needed here, just prevent actual sidecar calls

        executeCommandStub = sandbox.stub(commands, "executeCommand");
        setContextValueStub = sandbox.stub(contextValues, "setContextValue");

        // handle provider's `view` setup
        await provider.resolveWebviewView(stubbedWebviewView);
      });

      it("should set the current statement", async () => {
        assert.strictEqual(provider["currentStatement"], testStatement);

        const newStatement = createFlinkStatement({
          name: "new-statement",
          phase: Phase.RUNNING,
        });

        await provider.showStatementResults(newStatement);

        // shouldn't be testStatement anymore
        assert.strictEqual(provider["currentStatement"], newStatement);
      });

      it("should set the context value and focus the panel when .view hasn't been set yet", async () => {
        const providerWithoutView = new FlinkStatementResultsPanelProvider();

        try {
          // `currentStatement` and `view` aren't set yet on the new provider
          await providerWithoutView.showStatementResults(testStatement);

          sinon.assert.calledWith(
            setContextValueStub,
            contextValues.ContextValues.flinkStatementResultsPanelActive,
            true,
          );
          sinon.assert.calledWith(
            executeCommandStub,
            "confluent-flink-statement-results-panel.focus",
          );
        } finally {
          // always clean up even if the test or assertions fail
          providerWithoutView.dispose();
        }
      });
    });

    // can't test getStatementResultsHtml() due to the template import
  });
});
