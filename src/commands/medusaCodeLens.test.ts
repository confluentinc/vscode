import * as sinon from "sinon";
import * as vscode from "vscode";
import { LocalResourceKind } from "../docker/constants";
import * as dockerCommands from "./docker";
import * as commands from "./index";
import {
  COMMANDS,
  generateMedusaDatasetCommand,
  registerMedusaCodeLensCommands,
  startMedusaCommand,
} from "./medusaCodeLens";

describe("medusaCodeLens", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("generateMedusaDatasetCommand", () => {
    // todo patrick: this test will be replaced once proper call out to medusa is added in follow up pr
    it("should show information message with document URI path", async () => {
      const mockUri = vscode.Uri.file("/path/to/test.avsc");
      const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.calledWithMatch(
        showInfoStub,
        sinon.match(/Generate Medusa Dataset clicked for: .*test\.avsc/),
      );
    });
  });

  describe("startMedusaCommand", () => {
    it("should call runWorkflowWithProgress with Medusa resource kind", async () => {
      const runWorkflowStub = sandbox.stub(dockerCommands, "runWorkflowWithProgress").resolves();

      await startMedusaCommand();

      sinon.assert.calledOnce(runWorkflowStub);
      sinon.assert.calledWith(runWorkflowStub, true, [LocalResourceKind.Medusa]);
    });

    it("should show error message when workflow fails", async () => {
      const error = new Error("Docker not running");
      const runWorkflowStub = sandbox
        .stub(dockerCommands, "runWorkflowWithProgress")
        .rejects(error);
      const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

      await startMedusaCommand();

      sinon.assert.calledOnce(runWorkflowStub);
      sinon.assert.calledWith(runWorkflowStub, true, [LocalResourceKind.Medusa]);
      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(
        showErrorStub,
        "Failed to start Medusa container. Check the logs for details.",
      );
    });
  });

  describe("registerMedusaCodeLensCommands", () => {
    it("should register both generateDataset and start commands", () => {
      const registerCommandWithLoggingStub = sandbox
        .stub(commands, "registerCommandWithLogging")
        .returns({} as vscode.Disposable);

      registerMedusaCodeLensCommands();

      sinon.assert.calledTwice(registerCommandWithLoggingStub);
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub.firstCall,
        COMMANDS.GENERATE_DATASET,
        generateMedusaDatasetCommand,
      );
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub.secondCall,
        COMMANDS.START_MEDUSA,
        startMedusaCommand,
      );
    });
  });
});
