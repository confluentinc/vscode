import assert from "assert";
import sinon from "sinon";
import type { InputBoxValidationMessage } from "vscode";
import { env, InputBoxValidationSeverity, window } from "vscode";
import { EXTENSION_ID } from "../constants";
import { UriEventHandler } from "../uriHandler";
import { EXT_URI_PREFIX, handleUriCommand, uriValidator } from "./uris";

describe("commands/uris.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("handleUriCommand", () => {
    let showInputBoxStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let stubbedUriHandler: sinon.SinonStubbedInstance<UriEventHandler>;

    beforeEach(() => {
      showInputBoxStub = sandbox.stub(window, "showInputBox");
      showErrorMessageStub = sandbox.stub(window, "showErrorMessage");

      stubbedUriHandler = sandbox.createStubInstance(UriEventHandler);
      sandbox
        .stub(UriEventHandler, "getInstance")
        .returns(stubbedUriHandler as unknown as UriEventHandler);
    });

    it("should handle valid URI strings", async () => {
      const validUriString = `${env.uriScheme}://${EXTENSION_ID}/path`;
      showInputBoxStub.resolves(validUriString);

      await handleUriCommand();

      sinon.assert.calledOnce(showInputBoxStub);
      sinon.assert.notCalled(showErrorMessageStub);
      sinon.assert.calledOnce(stubbedUriHandler.handleUri);
      const calledWithUri = stubbedUriHandler.handleUri.getCall(0).args[0];
      assert.strictEqual(calledWithUri.toString(), validUriString);
    });

    it("should do nothing if the user cancels the input box", async () => {
      showInputBoxStub.resolves(undefined);

      await handleUriCommand();

      sinon.assert.calledOnce(showInputBoxStub);
      sinon.assert.notCalled(showErrorMessageStub);
      sinon.assert.notCalled(stubbedUriHandler.handleUri);
    });
  });

  describe("uriValidator()", () => {
    it("should return undefined for valid URIs", () => {
      const validUriString = `${EXT_URI_PREFIX}/path`;
      const result: InputBoxValidationMessage | undefined = uriValidator(validUriString);
      assert.strictEqual(result, undefined);
    });

    it("should return a validation error message for URIs with incorrect scheme", () => {
      const invalidUriString = `invalid-prefix:///${EXTENSION_ID}/path`;

      const result: InputBoxValidationMessage | undefined = uriValidator(invalidUriString);

      assert.ok(result);
      assert.strictEqual(result.message, `URI must start with ${EXT_URI_PREFIX}`);
      assert.strictEqual(result?.severity, InputBoxValidationSeverity.Error);
    });

    it("should return a validation error message for URIs with incorrect authority", () => {
      const invalidUriString = `${env.uriScheme}://wrong-authority/path`;

      const result: InputBoxValidationMessage | undefined = uriValidator(invalidUriString);

      assert.ok(result);
      assert.strictEqual(result.message, `URI must start with ${EXT_URI_PREFIX}`);
      assert.strictEqual(result?.severity, InputBoxValidationSeverity.Error);
    });
  });
});
