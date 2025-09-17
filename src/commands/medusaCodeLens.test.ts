import * as sinon from "sinon";
import * as vscode from "vscode";
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

  describe("startLocalMedusaCommand", () => {
    it("should show information message", async () => {
      const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

      await startMedusaCommand();

      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.calledWith(showInfoStub, "Start Local Medusa clicked!");
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
