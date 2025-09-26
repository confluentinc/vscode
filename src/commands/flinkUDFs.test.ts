import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { createResponseError } from "../../tests/unit/testUtils";
import { ArtifactV1FlinkArtifactMetadataFromJSON, ResponseError } from "../clients/flinkArtifacts";
import { ConnectionType } from "../clients/sidecar";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { CCloudEnvironment } from "../models/environment";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import {
  createUdfRegistrationDocumentCommand,
  registerFlinkUDFCommands,
  setFlinkUDFViewModeCommand,
  startGuidedUdfCreationCommand,
} from "./flinkUDFs";
import * as commands from "./index";
import * as uploadArtifact from "./utils/uploadArtifactOrUDF";

describe("flinkUDFs command", () => {
  let sandbox: sinon.SinonSandbox;

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

  let withProgressStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    withProgressStub = sandbox.stub(vscode.window, "withProgress");
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

  it("should return early if no artifact is provided in createUdfRegistrationDocumentCommand", async () => {
    const openTextDocStub = sandbox.stub(vscode.workspace, "openTextDocument");
    const showTextDocStub = sandbox.stub(vscode.window, "showTextDocument");

    await createUdfRegistrationDocumentCommand(undefined as any);

    sinon.assert.notCalled(openTextDocStub);
    sinon.assert.notCalled(showTextDocStub);
  });

  it("should register startGuidedUdfCreationCommand and createUdfRegistrationDocumentCommand", () => {
    const registerCommandWithLoggingStub = sandbox
      .stub(commands, "registerCommandWithLogging")
      .returns({} as vscode.Disposable);

    registerFlinkUDFCommands();

    sinon.assert.calledThrice(registerCommandWithLoggingStub);

    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub.getCall(0),
      "confluent.flinkdatabase.setUDFsViewMode",
      setFlinkUDFViewModeCommand,
    );
    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub.getCall(1),
      "confluent.artifacts.createUdfRegistrationDocument",
      createUdfRegistrationDocumentCommand,
    );
    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub.getCall(2),
      "confluent.artifacts.startGuidedUdfCreation",
      startGuidedUdfCreationCommand,
    );
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
    withProgressStub.callsFake(async (options, callback) => {
      return await callback(
        {
          report: () => {},
        },
        {},
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

    withProgressStub.callsFake(async (options, callback) => {
      return await callback(
        {
          report: () => {},
        },
        {},
      );
    });

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

    withProgressStub.callsFake(async (options, callback) => {
      return await callback(
        {
          report: () => {},
        },
        {},
      );
    });

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

    await startGuidedUdfCreationCommand(artifact);

    sinon.assert.calledOnce(promptStub);
    sinon.assert.notCalled(executeStub);
    sinon.assert.notCalled(withProgressStub);
    sinon.assert.notCalled(showInfoStub);
    sinon.assert.notCalled(showErrorStub);
  });

  it("should update UDFs list when a new one is created", async () => {
    const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
    const promptStub = sandbox.stub(uploadArtifact, "promptForFunctionAndClassName").resolves({
      functionName: "testFunction",
      className: "com.test.TestClass",
    });

    const mockProvider = sandbox.createStubInstance(FlinkDatabaseViewProvider);
    mockProvider.resource = mockCluster;
    sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(mockProvider);

    const executeStub = sandbox
      .stub(CCloudResourceLoader.getInstance(), "executeFlinkStatement")
      .resolves([{ created_at: JSON.stringify(new Date().toISOString()) }]);
    withProgressStub.callsFake(async (options, callback) => {
      return await callback({ report: () => {} }, {});
    });

    const stubbedEventEmitters = eventEmitterStubs(sandbox);
    const stubbedUDFsChangedEmitter = stubbedEventEmitters.udfsChanged!;

    await startGuidedUdfCreationCommand(artifact);

    sinon.assert.calledOnce(promptStub);
    sinon.assert.calledOnce(executeStub);
    sinon.assert.calledOnce(withProgressStub);
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledOnce(stubbedUDFsChangedEmitter.fire);
  });
});
