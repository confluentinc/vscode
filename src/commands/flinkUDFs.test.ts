import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
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
  registerFlinkUDFCommands,
  setFlinkUDFViewModeCommand,
  startGuidedUdfCreationCommand,
} from "./flinkUDFs";
import * as commands from "./index";
import * as uploadArtifact from "./utils/uploadArtifactOrUDF";

describe("commands/flinkUDFs.ts", () => {
  let sandbox: sinon.SinonSandbox;

  const artifact: FlinkArtifact = createFlinkArtifact();
  const mockEnvironment: CCloudEnvironment = TEST_CCLOUD_ENVIRONMENT;
  const mockDatabase: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("registerFlinkUDFCommands()", () => {
    it("should register expected Flink UDF commands", () => {
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
  });

  describe("startGuidedUdfCreationCommand()", () => {
    let showInfoStub: sinon.SinonStub;
    let showErrorStub: sinon.SinonStub;
    let promptStub: sinon.SinonStub;
    let fakeViewProvider: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    beforeEach(() => {
      showInfoStub = sandbox.stub(notifications, "showInfoNotificationWithButtons");
      showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

      // assume user sets function and class name by default for most tests
      promptStub = sandbox.stub(uploadArtifact, "promptForFunctionAndClassName").resolves({
        functionName: "testFunction",
        className: "com.test.TestClass",
      });

      fakeViewProvider = sandbox.createStubInstance(FlinkDatabaseViewProvider);
      fakeViewProvider.resource = mockDatabase;
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(fakeViewProvider);

      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      // one environment with no pools by default
      stubbedLoader.getEnvironments.resolves([mockEnvironment]);
    });

    it("should return early if no artifact argument is provided", async () => {
      await startGuidedUdfCreationCommand(undefined as any);

      sinon.assert.notCalled(promptStub);
      sinon.assert.notCalled(showInfoStub);
      sinon.assert.notCalled(showErrorStub);
    });

    it("should throw an error if the FlinkDatabaseViewProvider doesn't have a focused cluster/database", async () => {
      // shouldn't happen since this command is only available when the view has a focused database
      fakeViewProvider.resource = null;

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.notCalled(showInfoStub);
      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, "Failed to create UDF function: No Flink database.");
    });

    it("should exit silently if a user exits promptForFunctionAndClassName() early", async () => {
      // simulate the user cancelling the class/function inputs
      promptStub.resolves(undefined);

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.calledOnce(promptStub);
      sinon.assert.notCalled(stubbedLoader.executeFlinkStatement);
      // we should never make it to the withProgress block
      sinon.assert.notCalled(showInfoStub);
      sinon.assert.notCalled(showErrorStub);
    });

    it("should call promptForFunctionAndClassName() and show an info notification on success", async () => {
      stubbedLoader.executeFlinkStatement.resolves([
        { created_at: JSON.stringify(new Date().toISOString()) },
      ]);

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
      sinon.assert.calledOnce(stubbedLoader.executeFlinkStatement);
      sinon.assert.calledOnce(withProgressStub);
      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.notCalled(showErrorStub);
    });

    it("should show an error notification when executeFlinkStatement throws a ResponseError", async () => {
      const errorMessage = "Plain text error message";
      const fakeRespError: FlinkArtifactsResponseError = createResponseError(
        400,
        "Bad Request",
        errorMessage,
        ResponseErrorSource.FlinkArtifacts,
      );
      stubbedLoader.executeFlinkStatement.rejects(fakeRespError);

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWith(showErrorStub, `Failed to create UDF function: ${errorMessage}`);
    });

    it("should show an error notification when executeFlinkStatement throws a non-ResponseError error", async () => {
      // returns one environment with no pools
      const error = new Error("Something went wrong with UDF creation");
      stubbedLoader.executeFlinkStatement.rejects(error);

      await startGuidedUdfCreationCommand(artifact);

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithExactly(
        showErrorStub,
        `Failed to create UDF function: ${error.message}`,
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
});
