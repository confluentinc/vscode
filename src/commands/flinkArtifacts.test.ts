import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { createResponseError } from "../../tests/unit/testUtils";
import { ArtifactV1FlinkArtifactMetadataFromJSON, ResponseError } from "../clients/flinkArtifacts";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import { ConnectionType } from "../clients/sidecar";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { CCloudEnvironment } from "../models/environment";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import {
  createUdfRegistrationDocumentCommand,
  registerFlinkArtifactCommands,
  startGuidedUdfCreationCommand,
  uploadArtifactCommand,
} from "./flinkArtifacts";
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

  const mockEnvironment = TEST_CCLOUD_ENVIRONMENT;

  const mockCluster = {
    id: "cluster-123",
    name: "Flink DB Cluster",
    connectionId: artifact.connectionId,
    connectionType: ConnectionType.Ccloud,
    environmentId: artifact.environmentId,
    bootstrapServers: "pkc-xyz",
    provider: "aws",
    region: "us-west-2",
    flinkPools: [{ id: "compute-pool-1" }],
    isFlinkable: true,
    isSameCloudRegion: () => true,
    toFlinkSpecProperties: () => ({
      toProperties: () => ({}),
    }),
  } as unknown as CCloudFlinkDbKafkaCluster;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should open a new Flink SQL document with placeholder query for valid artifact", async () => {
    const openTextDocStub = sandbox
      .stub(vscode.workspace, "openTextDocument")
      .resolves({} as vscode.TextDocument);
    const insertSnippetStub = sandbox.stub().resolves();
    const showTextDocStub = sandbox.stub(vscode.window, "showTextDocument").resolves({
      insertSnippet: insertSnippetStub,
    } as unknown as vscode.TextEditor);

    await createUdfRegistrationDocumentCommand(artifact);

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

    await createUdfRegistrationDocumentCommand(undefined as any);

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
  it("should return early if no artifact is provided in startGuidedUdfCreationCommand", async () => {
    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
    const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

    const result = await startGuidedUdfCreationCommand(undefined as any);

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(showInfoStub);
    sinon.assert.notCalled(showErrorStub);
  });
  it("should throw an error if flinkDatabases is empty", async () => {
    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
    const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

    await startGuidedUdfCreationCommand(artifact);

    sinon.assert.notCalled(showInfoStub);
    sinon.assert.calledOnce(showErrorStub);
    sinon.assert.calledWith(showErrorStub, "Failed to create UDF function:  No Flink database.");
  });
  it("should prompt for function name and classname and show info message on success", async () => {
    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
    const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

    const promptStub = sandbox.stub(uploadArtifact, "promptForFunctionAndClassName").resolves({
      functionName: "testFunction",
      className: "com.test.TestClass",
    });

    const mockFlinkDatabaseViewProvider = {
      resource: mockCluster,
    };
    sandbox
      .stub(FlinkDatabaseViewProvider, "getInstance")
      .returns(mockFlinkDatabaseViewProvider as any);

    const executeStub = sandbox
      .stub(CCloudResourceLoader.getInstance(), "executeFlinkStatement")
      .resolves([{ created_at: JSON.stringify(new Date().toISOString()) }]);
    const withProgressStub = sandbox.stub(vscode.window, "withProgress");
    withProgressStub.callsFake(async (options, callback) => {
      return await callback(
        {
          report: () => {},
        },
        {} as any,
      );
    });

    await startGuidedUdfCreationCommand(artifact);

    sinon.assert.calledOnce(promptStub);
    sinon.assert.calledOnce(executeStub);
    sinon.assert.calledOnce(withProgressStub);
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.notCalled(showErrorStub);
  });

  it("should handle ResponseError with string response body in startGuidedUdfCreationCommand", async () => {
    const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
    sandbox.stub(uploadArtifact, "promptForFunctionAndClassName").resolves({
      functionName: "testFunction",
      className: "com.test.TestClass",
    });

    const mockEnvironmentNoComputePools: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [],
    });

    const mockProvider = sandbox.createStubInstance(FlinkDatabaseViewProvider);
    sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(mockProvider);
    mockProvider.resource = mockCluster;

    sandbox
      .stub(CCloudResourceLoader.getInstance(), "getEnvironments")
      .resolves([mockEnvironmentNoComputePools]);

    const responseForNewError = createResponseError(400, "Bad Request", "Plain text error message");
    const responseError: ResponseError = new ResponseError(
      responseForNewError.response,
      responseForNewError.message,
    );
    sandbox
      .stub(CCloudResourceLoader.getInstance(), "executeFlinkStatement")
      .rejects(responseError);

    await startGuidedUdfCreationCommand(artifact);

    sinon.assert.calledOnce(showErrorStub);
    sinon.assert.calledWith(
      showErrorStub,
      "Failed to create UDF function:  Plain text error message",
    );
  });

  it("should handle plain Error objects in startGuidedUdfCreationCommand", async () => {
    const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

    sandbox.stub(uploadArtifact, "promptForFunctionAndClassName").resolves({
      functionName: "testFunction",
      className: "com.test.TestClass",
    });

    sandbox
      .stub(FlinkDatabaseViewProvider, "getInstance")
      .returns({ resource: mockCluster } as any);

    sandbox
      .stub(CCloudResourceLoader.getInstance(), "getEnvironments")
      .resolves([mockEnvironment as CCloudEnvironment]);

    const error = new Error("Something went wrong with UDF creation");

    sandbox.stub(CCloudResourceLoader.getInstance(), "executeFlinkStatement").rejects(error);

    await startGuidedUdfCreationCommand(artifact);

    sinon.assert.calledOnce(showErrorStub);
    sinon.assert.calledWithExactly(
      showErrorStub,
      "Failed to create UDF function:  Something went wrong with UDF creation",
    );
  });

  it("should exit silently if a user exits the function and class name prompt", async () => {
    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
    const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

    const promptStub = sandbox
      .stub(uploadArtifact, "promptForFunctionAndClassName")
      .resolves(undefined as any);

    const mockFlinkDatabaseViewProvider = {
      resource: mockCluster,
    };
    sandbox
      .stub(FlinkDatabaseViewProvider, "getInstance")
      .returns(mockFlinkDatabaseViewProvider as any);

    const executeStub = sandbox.stub(CCloudResourceLoader.getInstance(), "executeFlinkStatement");

    const withProgressStub = sandbox.stub(vscode.window, "withProgress");

    await startGuidedUdfCreationCommand(artifact);

    sinon.assert.calledOnce(promptStub);
    sinon.assert.notCalled(executeStub);
    sinon.assert.notCalled(withProgressStub);
    sinon.assert.notCalled(showInfoStub);
    sinon.assert.notCalled(showErrorStub);
  });
});
