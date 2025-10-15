import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { createResponseError } from "../../tests/unit/testUtils";
import type {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import { registerFlinkArtifactCommands, uploadArtifactCommand } from "./flinkArtifacts";
import * as commands from "./index";
import * as artifactUploadForm from "./utils/artifactUploadForm";
import * as uploadArtifact from "./utils/uploadArtifactOrUDF";

describe("flinkArtifacts", () => {
  let sandbox: sinon.SinonSandbox;

  const mockParams = {
    environment: "env-123456",
    cloud: "Azure",
    region: "australiaeast",
    artifactName: "test-artifact",
    fileFormat: "jar",
    selectedFile: { fsPath: "/path/to/file.jar" } as vscode.Uri,
  };
  const mockPresignedUrlResponse = {
    upload_id: "12345",
    url: "https://example.com/upload",
    fields: {},
    api_version:
      "v1" as unknown as PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
    kind: "kind" as unknown as PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should register the uploadArtifact command", () => {
    const registerCommandWithLoggingStub = sandbox
      .stub(commands, "registerCommandWithLogging")
      .returns({} as vscode.Disposable);

    registerFlinkArtifactCommands();

    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub,
      "confluent.uploadArtifact",
      uploadArtifactCommand,
    );
  });

  it("should fail if there is no params", async () => {
    sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(undefined);
    const result = await uploadArtifactCommand();

    assert.strictEqual(result, undefined);
  });

  it("should show information message if uploadArtifactToCCloud is called successfully", async () => {
    const mockCreateResponse = {
      display_name: "test-artifact",
      cloud: "Azure",
      region: "australiaeast",
      environment: " env-123456",
    };

    sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(mockParams);
    sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
    sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
    sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").resolves(mockCreateResponse);

    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

    await uploadArtifactCommand();

    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWithMatch(showInfoStub, sinon.match(/uploaded successfully/));
  });

  it("should show error notification with custom error message when Error has message property", async () => {
    const params = { ...mockParams };
    const uploadUrl = { ...mockPresignedUrlResponse };

    sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(params);
    sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(uploadUrl);
    sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();

    const customErrorMessage = "Custom error message from Error instance";
    const error = new Error(customErrorMessage);

    sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(error);

    const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

    await uploadArtifactCommand();

    sinon.assert.calledOnce(showErrorStub);
    sinon.assert.calledWithMatch(showErrorStub, customErrorMessage);
  });

  it("should show custom clarification error when 500 status code is returned for invalid JAR file", async () => {
    const params = { ...mockParams };
    const uploadUrl = { ...mockPresignedUrlResponse };

    sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(params);
    sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(uploadUrl);
    sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();

    sandbox
      .stub(uploadArtifact, "uploadArtifactToCCloud")
      .rejects(createResponseError(500, "Oops, something went wrong", ""));

    const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

    await uploadArtifactCommand();

    sinon.assert.calledOnce(showErrorStub);
    sinon.assert.calledWithMatch(
      showErrorStub,
      "Please make sure that you provided a valid JAR file",
    );
  });

  it("should error for other status codes", async () => {
    const params = { ...mockParams };
    const uploadUrl = { ...mockPresignedUrlResponse };

    sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(params);
    sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(uploadUrl);
    sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();

    sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(
      createResponseError(
        400,
        "Custom Bad Request",
        JSON.stringify({
          errors: [
            {
              detail: "Custom Bad Request Body",
            },
          ],
        }),
      ),
    );

    const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

    await uploadArtifactCommand();

    sinon.assert.calledOnce(showErrorStub);
    sinon.assert.calledWithMatch(
      showErrorStub,
      "Failed to upload artifact: Custom Bad Request Body",
    );
  });

  it("should send the create artifact request to Confluent Cloud", async () => {
    const mockUploadId = "12345";
    const mockCreateResponse = {
      display_name: "test-artifact",
      id: "artifact-123",
      environment: "env-123456",
      region: "australiaeast",
      cloud: "Azure",
    };

    sandbox.stub(artifactUploadForm, "artifactUploadQuickPickForm").resolves(mockParams);
    sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
    const handleUploadStub = sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
    const createArtifactStub = sandbox
      .stub(uploadArtifact, "uploadArtifactToCCloud")
      .resolves(mockCreateResponse);
    sandbox.stub(vscode.window, "showInformationMessage");

    await uploadArtifactCommand();

    sinon.assert.calledOnce(handleUploadStub);
    sinon.assert.calledWithExactly(handleUploadStub, mockParams, mockPresignedUrlResponse);

    sinon.assert.calledOnce(createArtifactStub);
    sinon.assert.calledWithExactly(createArtifactStub, mockParams, mockUploadId);
  });
});
