import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedResourceManager } from "../../tests/stubs/extensionStorage";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  createFlinkArtifact,
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { createResponseError, ResponseErrorSource } from "../../tests/unit/testUtils";
import { ResponseError as FlinkArtifactsResponseError } from "../clients/flinkArtifacts";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { CCloudEnvironment } from "../models/environment";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import * as notifications from "../notifications";
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
import { createFlinkUDF } from "../../tests/unit/testResources/flinkUDF";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";

describe("commands/flinkUDFs.ts", () => {
  let sandbox: sinon.SinonSandbox;

  const artifact: FlinkArtifact = createFlinkArtifact();
  const mockEnvironment: CCloudEnvironment = TEST_CCLOUD_ENVIRONMENT;
  const mockDatabase: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

  let withProgressStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    withProgressStub = sandbox.stub(vscode.window, "withProgress").callsFake((_, callback) => {
      const mockProgress = {
        report: sandbox.stub(),
      } as vscode.Progress<unknown>;
      const mockToken = {} as vscode.CancellationToken;
      return Promise.resolve(callback(mockProgress, mockToken));
    });
  });

  afterEach(() => {
    sandbox.restore();
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
      mockFlinkDatabaseViewProvider.resource = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
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

      const responseError: FlinkArtifactsResponseError = createResponseError(
        500,
        "Internal Server Error",
        "Database connection failed",
      );
      executeFlinkStatementStub.rejects(responseError);
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
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(
          {
            report: progressReportStub,
          },
          {} as vscode.CancellationToken,
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

  describe("registerFlinkUDFCommands()", () => {
    it("should register expected Flink UDF commands", () => {
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
  });

  describe("createUdfRegistrationDocumentCommand()", () => {
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
      flinkDatabaseProviderStub.resource = mockDatabase;
      ccloudLoaderStub.getEnvironment.resolves(mockEnvironment);

      await createUdfRegistrationDocumentCommand(artifact);

      sinon.assert.calledOnce(resourceManagerStub.setUriMetadata);
      const setMetadataCall = resourceManagerStub.setUriMetadata.getCall(0);
      assert.strictEqual(setMetadataCall.args[0], mockDocument.uri);

      const expectedMetadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: mockDatabase.flinkPools[0]?.id || null,
        [UriMetadataKeys.FLINK_CATALOG_ID]: mockEnvironment.id,
        // no catalog name since that would require the loader to look up the environment, so the
        // codelens provider should be handling that
        [UriMetadataKeys.FLINK_DATABASE_ID]: mockDatabase.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: mockDatabase.name,
      };
      assert.deepStrictEqual(setMetadataCall.args[1], expectedMetadata);

      sinon.assert.calledOnce(openTextDocStub);
      sinon.assert.calledOnce(showTextDocStub);
      sinon.assert.calledOnce(insertSnippetStub);
    });
  });

  describe("startGuidedUdfCreationCommand()", () => {
    let fakeViewProvider: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;
    let promptStub: sinon.SinonStub;
    let executeCreateFunctionStub: sinon.SinonStub;
    let stubbedUDFsChangedEmitter: sinon.SinonStubbedInstance<
      vscode.EventEmitter<CCloudFlinkDbKafkaCluster>
    >;
    let showErrorStub: sinon.SinonStub;

    const functionName = "testFunction";
    const className = "com.test.TestClass";

    beforeEach(() => {
      fakeViewProvider = sandbox.createStubInstance(FlinkDatabaseViewProvider);
      fakeViewProvider.resource = mockDatabase;
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(fakeViewProvider);

      // assume user sets function and class name by default for most tests
      promptStub = sandbox.stub(uploadArtifact, "promptForFunctionAndClassName").resolves({
        functionName,
        className,
      });
      executeCreateFunctionStub = sandbox.stub(uploadArtifact, "executeCreateFunction").resolves();
      stubbedUDFsChangedEmitter = eventEmitterStubs(sandbox).udfsChanged!;

      showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
    });

    it("should return early if no artifact argument is provided", async () => {
      await startGuidedUdfCreationCommand(undefined as any);

      sinon.assert.notCalled(promptStub);
      sinon.assert.notCalled(withProgressStub);
      sinon.assert.notCalled(executeCreateFunctionStub);
      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
      sinon.assert.notCalled(showErrorStub);
    });

    it("should throw an error if the FlinkDatabaseViewProvider doesn't have a focused cluster/database", async () => {
      // shouldn't happen since this command is only available when the view has a focused database
      fakeViewProvider.resource = null;

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.notCalled(promptStub);
      sinon.assert.notCalled(withProgressStub);
      sinon.assert.notCalled(executeCreateFunctionStub);
      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, "Failed to create UDF function: No Flink database.");
    });

    it("should exit silently if a user exits promptForFunctionAndClassName() early", async () => {
      // simulate the user cancelling the class/function inputs
      promptStub.resolves(undefined);

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.calledOnce(promptStub);
      sinon.assert.notCalled(withProgressStub);
      sinon.assert.notCalled(executeCreateFunctionStub);
      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
      sinon.assert.notCalled(showErrorStub);
    });

    it("should call promptForFunctionAndClassName() and show an info notification on success", async () => {
      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.calledOnce(promptStub);
      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledWithExactly(
        executeCreateFunctionStub,
        artifact,
        { functionName, className },
        mockDatabase,
      );
      sinon.assert.calledOnceWithExactly(stubbedUDFsChangedEmitter.fire, mockDatabase);
      sinon.assert.notCalled(showErrorStub);
    });

    it("should show an error notification when executeCreateFunction() throws a ResponseError", async () => {
      const errorMessage = "Plain text error message";
      const fakeRespError: FlinkArtifactsResponseError = createResponseError(
        400,
        "Bad Request",
        errorMessage,
        ResponseErrorSource.FlinkArtifacts,
      );
      executeCreateFunctionStub.rejects(fakeRespError);

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.calledOnce(promptStub);
      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledOnce(executeCreateFunctionStub);
      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, `Failed to create UDF function: ${errorMessage}`);
    });

    it("should show an error notification when executeFlinkStatement throws a non-ResponseError error", async () => {
      // returns one environment with no pools
      const error = new Error("Something went wrong with UDF creation");
      executeCreateFunctionStub.rejects(error);

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.calledOnce(promptStub);
      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledOnce(executeCreateFunctionStub);
      sinon.assert.notCalled(stubbedUDFsChangedEmitter.fire);
      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithExactly(
        showErrorStub,
        `Failed to create UDF function: ${error.message}`,
      );
    });
  });
});
