import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { eventEmitterStubs, StubbedEventEmitters } from "../../tests/stubs/emitters";
import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { createResponseError } from "../../tests/unit/testUtils";
import {
  ArtifactV1FlinkArtifactMetadataFromJSON,
  FlinkArtifactsArtifactV1Api,
} from "../clients/flinkArtifacts";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrl200Response";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import * as contextValuesModule from "../context/values";
import { flinkArtifactUDFViewMode } from "../emitters";
import * as errors from "../errors";
import * as contextValues from "../context/values";
import { FlinkArtifact } from "../models/flinkArtifact";
import { ConnectionId, EnvironmentId } from "../models/resource";
import * as sidecar from "../sidecar";
import { FlinkArtifactsViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
import {
  deleteArtifactCommand,
  queryArtifactWithFlink,
  registerFlinkArtifactCommands,
  setFlinkArtifactsViewModeCommand,
  uploadArtifactCommand,
} from "./flinkArtifacts";
import * as commands from "./index";
import * as uploadArtifact from "./utils/uploadArtifact";

describe("flinkArtifacts", () => {
  let sandbox: sinon.SinonSandbox;

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
});

describe("uploadArtifact Command", () => {
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

  describe("uploadArtifactCommand", () => {
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

    it("should show error notification with error message from JSON-formatted message if present", async () => {
      const params = { ...mockParams };
      const uploadUrl = { ...mockPresignedUrlResponse };

      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(params);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(uploadUrl);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();

      const errorMessage = "Artifact already exists";
      const respJson = { error: { message: errorMessage } };

      const responseError = createResponseError(409, "Conflict", JSON.stringify(respJson));

      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(showErrorStub, errorMessage);
    });

    it("Should throw Error if upload_id is missing in presigned URL response", async () => {
      const params = { ...mockParams };
      const uploadUrl = { ...mockPresignedUrlResponse, upload_id: undefined };

      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(params);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(uploadUrl);

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledOnce(showErrorStub);
      sinon.assert.calledWithMatch(
        showErrorStub,
        "Upload ID is missing from the presigned URL response.",
      );
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
      const handleUploadStub = sandbox
        .stub(uploadArtifact, "handleUploadToCloudProvider")
        .resolves();
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

    describe("registerArtifactCommand", () => {
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
        sinon.assert.calledWithExactly(
          registerCommandWithLoggingStub,
          "confluent.deleteArtifact",
          deleteArtifactCommand,
        );
        sinon.assert.calledWithExactly(
          registerCommandWithLoggingStub,
          "confluent.flinkdatabase.setArtifactsViewMode",
          setFlinkArtifactsViewModeCommand,
        );
        sinon.assert.calledWithExactly(
          registerCommandWithLoggingStub,
          "confluent.artifacts.registerUDF",
          queryArtifactWithFlink,
        );
      });
    });
  });

  describe("deleteArtifactCommand", () => {
    let sandbox: sinon.SinonSandbox;
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
        sandbox.createStubInstance(sidecar.SidecarHandle);
      let flinkArtifactsApiStub = sandbox.createStubInstance(FlinkArtifactsArtifactV1Api);
      mockSidecarHandle.getFlinkArtifactsApi.returns(flinkArtifactsApiStub);
      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
    });
    afterEach(() => {
      sandbox.restore();
    });

    const mockArtifact: FlinkArtifact = {
      id: "artifact-id",
      name: "Test Artifact",
      provider: "aws",
      region: "us-west-2",
      environmentId: "env-id" as EnvironmentId,
      connectionId: "conn-id" as ConnectionId,
      iconName: IconNames.FLINK_ARTIFACT,
      description: "",
      searchableText: () => "",
      connectionType: ConnectionType.Local,
      ccloudUrl: "https://confluent.io",
      documentationLink: "https://confluent.io",
      metadata: ArtifactV1FlinkArtifactMetadataFromJSON({
        self: {},
        resource_name: "test-artifact",
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: new Date(),
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    describe("deleteArtifactCommand", () => {
      it("should exit silently if user does not confirm that they want to delete the artifact", async () => {
        sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
        const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        const deleteArtifactV1FlinkArtifactStub = sandbox.stub().resolves();

        await deleteArtifactCommand(mockArtifact);

        sinon.assert.notCalled(deleteArtifactV1FlinkArtifactStub);
        sinon.assert.notCalled(showInformationMessageStub);
      });
      it("should call the sidecar to delete the artifact and show a success message", async () => {
        sandbox.stub(vscode.window, "showWarningMessage").resolves({ title: "Yes, delete" });
        const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");

        await deleteArtifactCommand(mockArtifact);
        sinon.assert.calledOnce(showInformationMessageStub);
      });
      it("should return early and show an error message if no selected artifact is provided", async () => {
        const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
        await deleteArtifactCommand(undefined);
        sinon.assert.calledWithMatch(showErrorStub, "No Flink artifact selected for deletion.");
      });
    });
  });

  describe("setFlinkArtifactsViewModeCommand", () => {
    it("should fire the view mode event and set the context value", async () => {
      const fireStub = sandbox.stub(flinkArtifactUDFViewMode, "fire");
      const setContextStub = sandbox.stub().resolves();
      sandbox.replace(contextValuesModule, "setContextValue", setContextStub);

      await setFlinkArtifactsViewModeCommand();

      sinon.assert.calledOnceWithExactly(fireStub, FlinkArtifactsViewProviderMode.Artifacts);
      sinon.assert.calledOnceWithExactly(
        setContextStub,
        contextValuesModule.ContextValues.flinkArtifactsUDFsViewMode,
        FlinkArtifactsViewProviderMode.Artifacts,
      );
    });
  });

  describe("uploadArtifactCommand error message extraction", () => {
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();

      sandbox.stub(uploadArtifact, "promptForArtifactUploadParams").resolves(mockParams);
      sandbox.stub(uploadArtifact, "getPresignedUploadUrl").resolves(mockPresignedUrlResponse);
      sandbox.stub(uploadArtifact, "handleUploadToCloudProvider").resolves();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it("should extract error message from errors[0].detail", async () => {
      const responseError = createResponseError(400, "Bad Request", "");
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      const errorDetail = "Error in detail field";
      sandbox.stub(errors, "isResponseError").returns(true);
      sandbox.stub(errors, "extractResponseBody").resolves({
        errors: [{ detail: errorDetail }],
      });

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledWithExactly(showErrorStub, errorDetail);
    });

    it("should extract error message from message property", async () => {
      const responseError = createResponseError(400, "Bad Request", "");
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      const messageText = "Message in message field";
      sandbox.stub(errors, "isResponseError").returns(true);
      sandbox.stub(errors, "extractResponseBody").resolves({
        message: messageText,
      });

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledWithExactly(showErrorStub, messageText);
    });

    it("should extract error message from error.message property", async () => {
      const responseError = createResponseError(400, "Bad Request", "");
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      const errorMessage = "Message in error.message field";
      sandbox.stub(errors, "isResponseError").returns(true);
      sandbox.stub(errors, "extractResponseBody").resolves({
        error: { message: errorMessage },
      });

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledWithExactly(showErrorStub, errorMessage);
    });

    it("should use string response directly when response is a string", async () => {
      const responseError = createResponseError(400, "Bad Request", "");
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      const stringResponse = "Plain string error response";
      sandbox.stub(errors, "isResponseError").returns(true);
      sandbox.stub(errors, "extractResponseBody").resolves(stringResponse);

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledWithExactly(showErrorStub, stringResponse);
    });

    it("should use JSON.stringify for unknown response format", async () => {
      const responseError = createResponseError(400, "Bad Request", "");
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      const unknownResponse = { foo: "bar", baz: 123 };
      sandbox.stub(errors, "isResponseError").returns(true);
      sandbox.stub(errors, "extractResponseBody").resolves(unknownResponse);

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);

      await uploadArtifactCommand();

      sinon.assert.calledWithExactly(showErrorStub, JSON.stringify(unknownResponse));
    });

    it("should use default message when extractResponseBody throws", async () => {
      const responseError = createResponseError(400, "Bad Request", "");
      sandbox.stub(uploadArtifact, "uploadArtifactToCCloud").rejects(responseError);

      sandbox.stub(errors, "isResponseError").returns(true);
      sandbox.stub(errors, "extractResponseBody").rejects(new Error("Failed to extract"));

      const showErrorStub = getShowErrorNotificationWithButtonsStub(sandbox);
      await uploadArtifactCommand();

      sinon.assert.calledWithExactly(
        showErrorStub,
        "Failed to upload artifact. Please check logs for details.",
      );
    });
  });

  describe("setFlinkArtifactsViewModeCommand", () => {
    it("should set the Flink Database view to Artifacts mode", async () => {
      const setContextValueStub = sandbox.stub(contextValues, "setContextValue");
      const stubbedEventEmitters: StubbedEventEmitters = eventEmitterStubs(sandbox);
      const flinkDatabaseViewModeFireStub = stubbedEventEmitters.flinkDatabaseViewMode!.fire;

      await setFlinkArtifactsViewModeCommand();

      sinon.assert.calledOnce(flinkDatabaseViewModeFireStub);
      sinon.assert.calledOnce(setContextValueStub);
      sinon.assert.calledWithExactly(
        setContextValueStub,
        contextValues.ContextValues.flinkDatabaseViewMode,
        FlinkDatabaseViewProviderMode.Artifacts,
      );
    });
  });
});
