import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as commands from "./index";
import * as uploadUDFCommand from "./uploadUDF";
import * as uploadUDF from "./utils/uploadUDF";

describe("uploadUDF Command", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("uploadUDFCommand", () => {
    it("should fail if there is no params", async () => {
      sandbox.stub(uploadUDF, "promptForUDFUploadParams").resolves(undefined);
      const result = await uploadUDFCommand.uploadUDFCommand();

      assert.strictEqual(result, undefined);
    });
    it("should show information message if handeluUploadFile is called successfully", async () => {
      sandbox.stub(uploadUDF, "handleUploadFile").resolves();

      const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

      await uploadUDFCommand.uploadUDFCommand();

      sinon.assert.calledOnce(showInfoStub);
    });
    it("should show error message if handleUploadFile fails", async () => {
      const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

      await uploadUDFCommand.uploadUDFCommand();

      sinon.assert.calledOnce(showErrorStub);
    });
  });
  describe("registerUploadUDFCommand", () => {
    it("should register the uploadUDF command", () => {
      const registerCommandWithLoggingStub = sandbox
        .stub(commands, "registerCommandWithLogging")
        .returns({} as vscode.Disposable);

      uploadUDFCommand.registerUploadUDFCommand();

      sinon.assert.calledOnce(registerCommandWithLoggingStub);
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.uploadUDF",
        uploadUDFCommand.uploadUDFCommand,
      );
    });
  });
});
