import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { ArtifactV1FlinkArtifactMetadataFromJSON } from "../clients/flinkArtifacts";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import { ConnectionType } from "../clients/sidecar";
import { FlinkArtifact } from "../models/flinkArtifact";
import { ConnectionId, EnvironmentId } from "../models/resource";
import {
  queryArtifactWithFlink,
  registerFlinkArtifactCommands,
  uploadArtifactCommand,
} from "./flinkArtifacts";
import * as commands from "./index";
import * as uploadArtifact from "./utils/uploadArtifact";

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

  it("should open a new Flink SQL document with placeholder query for valid artifact", async () => {
    const artifact = new FlinkArtifact({
      id: "artifact-id",
      name: "test-artifact",
      description: "description",
      connectionId: "conn-id" as ConnectionId,
      connectionType: "ccloud" as ConnectionType,
      environmentId: "env-id" as EnvironmentId,
      provider: "aws",
      region: "us-west-2",
      documentationLink: "https://confluent.io",
      metadata: ArtifactV1FlinkArtifactMetadataFromJSON({
        self: {},
        resource_name: "test-artifact",
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: new Date(),
      }),
    });
    const openTextDocStub = sandbox
      .stub(vscode.workspace, "openTextDocument")
      .resolves({} as vscode.TextDocument);
    // Fix: stub showTextDocument to return an editor with insertSnippet stub
    const insertSnippetStub = sandbox.stub().resolves();
    const showTextDocStub = sandbox.stub(vscode.window, "showTextDocument").resolves({
      insertSnippet: insertSnippetStub,
    } as unknown as vscode.TextEditor);

    await queryArtifactWithFlink(artifact);

    sinon.assert.calledOnce(openTextDocStub);
    const callArgs = openTextDocStub.getCall(0).args[0];
    assert.ok(callArgs, "openTextDocStub was not called with any arguments");
    assert.strictEqual(callArgs.language, "flinksql");
    sinon.assert.calledOnce(showTextDocStub);
    sinon.assert.calledOnce(insertSnippetStub);
    const snippetArg = insertSnippetStub.getCall(0).args[0];
    assert.ok(
      typeof snippetArg.value === "string" && snippetArg.value.includes("CREATE FUNCTION"),
      "insertSnippet should be called with a snippet containing CREATE FUNCTION",
    );
  });
  it("should return early if no artifact is provided", async () => {
    const openTextDocStub = sandbox.stub(vscode.workspace, "openTextDocument");
    const showTextDocStub = sandbox.stub(vscode.window, "showTextDocument");

    await queryArtifactWithFlink(undefined);

    sinon.assert.notCalled(openTextDocStub);
    sinon.assert.notCalled(showTextDocStub);
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
    sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(undefined);
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

    sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
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

    sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(params);
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

  it("should send the create artifact request to Confluent Cloud", async () => {
    const mockUploadId = "12345";
    const mockCreateResponse = {
      display_name: "test-artifact",
      id: "artifact-123",
      environment: "env-123456",
      region: "australiaeast",
      cloud: "Azure",
    };

    sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
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
