import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedResourceManager } from "../../tests/stubs/extensionStorage";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { createFlinkUDF } from "../../tests/unit/testResources/flinkUDF";
import { createResponseError } from "../../tests/unit/testUtils";
import { ArtifactV1FlinkArtifactMetadataFromJSON, ResponseError } from "../clients/flinkArtifacts";
import { ConnectionType } from "../clients/sidecar";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { CCloudEnvironment } from "../models/environment";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import {
  createUdfRegistrationDocumentCommand,
  deleteFlinkUDFCommand,
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

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should register deleteFlinkUDFCommand, startGuidedUdfCreationCommand and createUdfRegistrationDocumentCommand", () => {
    const registerCommandWithLoggingStub = sandbox
      .stub(commands, "registerCommandWithLogging")
      .returns({} as vscode.Disposable);

    registerFlinkUDFCommands();

    sinon.assert.callCount(registerCommandWithLoggingStub, 4);

    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub.getCall(0),
      "confluent.deleteFlinkUDF",
      deleteFlinkUDFCommand,
    );
    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub.getCall(1),
      "confluent.flinkdatabase.setUDFsViewMode",
      setFlinkUDFViewModeCommand,
    );
    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub.getCall(2),
      "confluent.artifacts.createUdfRegistrationDocument",
      createUdfRegistrationDocumentCommand,
    );
    sinon.assert.calledWithExactly(
      registerCommandWithLoggingStub.getCall(3),
      "confluent.artifacts.startGuidedUdfCreation",
      startGuidedUdfCreationCommand,
    );
  });

  describe("deleteFlinkUDFCommand", () => {
    const mockUDF = createFlinkUDF("123");
    let executeFlinkStatementStub: sinon.SinonStub;
    let showWarningStub: sinon.SinonStub;
    let mockFlinkDatabaseViewProvider: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;

    beforeEach(() => {
      executeFlinkStatementStub = sandbox.stub(
        CCloudResourceLoader.getInstance(),
        "executeFlinkStatement",
      );
      showWarningStub = sandbox.stub(vscode.window, "showWarningMessage");
      mockFlinkDatabaseViewProvider = sandbox.createStubInstance(FlinkDatabaseViewProvider);

      // By default, set the mock provider to return a valid cluster
      mockFlinkDatabaseViewProvider.resource = mockCluster;
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(mockFlinkDatabaseViewProvider);
    });

    it("should return early if no UDF is provided", async () => {
      await deleteFlinkUDFCommand(undefined as any);

      sinon.assert.notCalled(showWarningStub);
      sinon.assert.notCalled(executeFlinkStatementStub);
    });

    it("should open a confirmation modal and return early if the user cancels", async () => {
      showWarningStub.resolves({ title: "Cancel" });

      await deleteFlinkUDFCommand(mockUDF);

      sinon.assert.calledOnce(showWarningStub);

      sinon.assert.notCalled(executeFlinkStatementStub);
    });

    it("should handle 'No Flink database' error", async () => {
      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      showWarningStub.resolves("Yes, delete");

      // Override the mock provider to return no database
      mockFlinkDatabaseViewProvider.resource = null;

      await deleteFlinkUDFCommand(mockUDF);

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, "Failed to delete UDF: No Flink database.");
      sinon.assert.notCalled(executeFlinkStatementStub);
    });

    it("should handle ResponseError in catch block", async () => {
      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      showWarningStub.resolves("Yes, delete");

      const responseError = createResponseError(
        500,
        "Internal Server Error",
        "Database connection failed",
      );
      executeFlinkStatementStub.rejects(
        new ResponseError(responseError.response, responseError.message),
      );

      await deleteFlinkUDFCommand(mockUDF);

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, "Failed to delete UDF: Database connection failed");
    });

    it("should extract flink detail from error message when available", async () => {
      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      showWarningStub.resolves("Yes, delete");

      const errorWithDetail = new Error(
        "Some error occurred Error detail: Function not found in catalog",
      );
      executeFlinkStatementStub.rejects(errorWithDetail);

      await deleteFlinkUDFCommand(mockUDF);

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, "Failed to delete UDF: Function not found in catalog");
    });

    it("should use regular error message when no flink detail available", async () => {
      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      showWarningStub.resolves("Yes, delete");

      const regularError = new Error("Connection timeout");
      executeFlinkStatementStub.rejects(regularError);

      await deleteFlinkUDFCommand(mockUDF);

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, "Failed to delete UDF: Connection timeout");
    });

    it("should report progress messages during successful deletion", async () => {
      const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
      showWarningStub.resolves("Yes, delete");

      const progressReportStub = sandbox.stub();
      const withProgressStub = sandbox.stub(vscode.window, "withProgress");
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(
          {
            report: progressReportStub,
          },
          {} as any,
        );
      });

      executeFlinkStatementStub.resolves({ dropped_at: new Date().toISOString() });

      await deleteFlinkUDFCommand(mockUDF);

      sinon.assert.calledThrice(progressReportStub);
      sinon.assert.calledOnce(mockFlinkDatabaseViewProvider.refresh);
      sinon.assert.calledWith(mockFlinkDatabaseViewProvider.refresh, true);
      sinon.assert.calledOnce(showInfoStub);
    });
  });

  describe("createUdfRegistrationDocumentCommand", () => {
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
  });

  describe("startGuidedUdfCreationCommand", () => {
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

      const responseForNewError = createResponseError(
        400,
        "Bad Request",
        "Plain text error message",
      );
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

  describe("createUdfRegistrationDocumentCommand", () => {
    let resourceManagerStub: sinon.SinonStubbedInstance<ResourceManager>;
    let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let flinkDatabaseProviderStub: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;
    let openTextDocStub: sinon.SinonStub;
    let showTextDocStub: sinon.SinonStub;
    let insertSnippetStub: sinon.SinonStub;

    beforeEach(() => {
      resourceManagerStub = getStubbedResourceManager(sandbox);
      ccloudLoaderStub = getStubbedCCloudResourceLoader(sandbox);

      flinkDatabaseProviderStub = sandbox.createStubInstance(FlinkDatabaseViewProvider);
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(flinkDatabaseProviderStub);

      insertSnippetStub = sandbox.stub().resolves();
      openTextDocStub = sandbox.stub(vscode.workspace, "openTextDocument");
      showTextDocStub = sandbox.stub(vscode.window, "showTextDocument");
    });

    it("should open a new Flink SQL document with placeholder query for valid artifact", async () => {
      openTextDocStub.resolves({});
      showTextDocStub.resolves({
        insertSnippet: insertSnippetStub,
      });

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
      await createUdfRegistrationDocumentCommand(undefined as any);

      sinon.assert.notCalled(openTextDocStub);
      sinon.assert.notCalled(showTextDocStub);
    });

    it("should set URI metadata when both database and catalog are available", async () => {
      const mockDocument = { uri: vscode.Uri.parse("untitled:Untitled-1") };
      openTextDocStub.resolves(mockDocument);
      showTextDocStub.resolves({
        insertSnippet: insertSnippetStub,
      });
      sandbox.stub(flinkDatabaseProviderStub, "database").get(() => mockCluster);
      ccloudLoaderStub.getEnvironment.resolves(mockEnvironment);

      await createUdfRegistrationDocumentCommand(artifact);

      sinon.assert.calledOnce(resourceManagerStub.setUriMetadata);
      const setMetadataCall = resourceManagerStub.setUriMetadata.getCall(0);
      assert.strictEqual(setMetadataCall.args[0], mockDocument.uri);

      const expectedMetadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: mockCluster.flinkPools[0]?.id || null,
        [UriMetadataKeys.FLINK_CATALOG_ID]: mockEnvironment.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: mockEnvironment.name,
        [UriMetadataKeys.FLINK_DATABASE_ID]: mockCluster.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: mockCluster.name,
      };
      assert.deepStrictEqual(setMetadataCall.args[1], expectedMetadata);

      sinon.assert.calledOnce(openTextDocStub);
      sinon.assert.calledOnce(showTextDocStub);
      sinon.assert.calledOnce(insertSnippetStub);
    });
  });
});
