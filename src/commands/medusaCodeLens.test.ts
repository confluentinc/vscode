import * as sinon from "sinon";
import * as vscode from "vscode";
import * as commands from "./index";
import {
  generateMedusaDatasetCommand,
  MEDUSA_COMMANDS,
  registerMedusaCodeLensCommands,
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
        sinon.match(/Generate Medusa Dataset clicked for: \/path\/to\/test\.avsc/),
      );
    });
  });

  describe("registerMedusaCodeLensCommands", () => {
    it("should register the generateDataset command", () => {
      const registerCommandWithLoggingStub = sandbox
        .stub(commands, "registerCommandWithLogging")
        .returns({} as vscode.Disposable);

      registerMedusaCodeLensCommands();

      sinon.assert.calledOnce(registerCommandWithLoggingStub);
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        MEDUSA_COMMANDS.GENERATE_DATASET,
        generateMedusaDatasetCommand,
      );
    });
  });
});
