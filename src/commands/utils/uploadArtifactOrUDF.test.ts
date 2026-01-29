import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import {
  createFlinkArtifact,
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_ARTIFACT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../../tests/unit/testResources";
import { TokenManager } from "../../auth/oauth2/tokenManager";
import type { PresignedUploadUrlArtifactV1PresignedUrl200Response } from "../../clients/flinkArtifacts";
import {
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../../clients/flinkArtifacts";
import type { CCloudResourceLoader } from "../../loaders";
import type { FlinkArtifact } from "../../models/flinkArtifact";
import * as notifications from "../../notifications";
import * as fsWrappers from "../../utils/fsWrappers";
import { FlinkDatabaseViewProvider } from "../../viewProviders/flinkDatabase";
import * as uploadArtifactModule from "./uploadArtifactOrUDF";
import {
  buildCreateArtifactRequest,
  executeCreateFunction,
  handleUploadToCloudProvider,
  prepareUploadFileFromUri,
  PRESIGNED_URL_LOCATION,
  promptForFunctionAndClassName,
} from "./uploadArtifactOrUDF";
import * as uploadToProvider from "./uploadToProvider";

describe("commands/utils/uploadArtifact", () => {
  let sandbox: sinon.SinonSandbox;
  let tempJarPath: string;
  let tempJarUri: vscode.Uri;
  const tempDir = os.tmpdir();

  const mockAzureParams = {
    environment: "env-123456",
    cloud: "Azure",
    region: "australiaeast",
    artifactName: "test-artifact",
    fileFormat: "jar",
    selectedFile: undefined as unknown as vscode.Uri,
  };

  const mockAwsParams = {
    environment: "env-123456",
    cloud: "AWS",
    region: "us-east-1",
    artifactName: "test-artifact",
    fileFormat: "jar",
    selectedFile: undefined as unknown as vscode.Uri,
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    tempJarPath = path.join(tempDir, `test-artifact-${Date.now()}.jar`);
    fs.writeFileSync(tempJarPath, "dummy jar content");
    tempJarUri = vscode.Uri.file(tempJarPath);
    mockAzureParams.selectedFile = tempJarUri;
    mockAwsParams.selectedFile = tempJarUri;
  });

  afterEach(() => {
    sandbox.restore();
    // Clean up temp files created for tests
    if (tempJarPath && fs.existsSync(tempJarPath)) {
      try {
        fs.unlinkSync(tempJarPath);
      } catch {
        // ignore errors on cleanup
      }
    }
  });

  describe("prepareUploadFileFromUri", () => {
    it("should prepare the file for upload", async () => {
      const mockBuffer = Buffer.from("test file content");
      const readFileBufferStub = sandbox.stub(fsWrappers, "readFileBuffer").resolves(mockBuffer);
      const mockUri = { fsPath: "/path/to/file.jar" } as vscode.Uri;
      const result = await prepareUploadFileFromUri(mockUri);

      sinon.assert.calledOnceWithExactly(readFileBufferStub, mockUri);

      assert.deepStrictEqual(result, {
        blob: new Blob([mockBuffer], { type: "application/java-archive" }),
        contentType: "application/java-archive",
      });
    });

    it("should throw an error for files larger than 100MB", async () => {
      const mockBuffer = Buffer.alloc(101 * 1024 * 1024); // 101MB
      sandbox.stub(fsWrappers, "readFileBuffer").resolves(mockBuffer);

      const mockUri = { fsPath: "/path/to/large-file.jar" } as vscode.Uri;

      await assert.rejects(
        () => prepareUploadFileFromUri(mockUri),
        /File size 101.00MB exceeds the maximum allowed size of 100MB/,
      );
    });

    it("should not throw an error for files smaller than or equal to 100MB", async () => {
      const mockBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      sandbox.stub(fsWrappers, "readFileBuffer").resolves(mockBuffer);

      const mockUri = { fsPath: "/path/to/small-file.jar" } as vscode.Uri;
      const showErrorStub = sandbox
        .stub(notifications, "showErrorNotificationWithButtons")
        .resolves();

      await assert.doesNotReject(() => prepareUploadFileFromUri(mockUri));

      sinon.assert.notCalled(showErrorStub);
    });

    it("should throw an error if the file does not exist", async () => {
      const mockUri = { fsPath: "/path/to/nonexistent.jar" } as vscode.Uri;
      await assert.rejects(() => prepareUploadFileFromUri(mockUri), Error);
    });
  });

  describe("getPresignedUploadUrl", () => {
    let tokenStub: sinon.SinonStub;
    let fetchStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub token manager to return a token
      tokenStub = sandbox.stub(TokenManager, "getInstance");
      tokenStub.returns({
        getDataPlaneToken: sandbox.stub().resolves("test-token"),
      });
    });

    afterEach(() => {
      fetchStub?.restore();
    });

    it("should return presigned URL response from API", async () => {
      const mockResponse = {
        api_version: "artifact/v1",
        kind: "PresignedUrl",
        upload_id: "test-upload-id",
        upload_url: "https://storage.example.com/upload",
        cloud: "AWS",
        region: "us-east-1",
        environment: "env-123456",
        content_format: "JAR",
      };

      fetchStub = sandbox.stub(global, "fetch").resolves({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => mockResponse,
      } as Response);

      const request = {
        cloud: "AWS",
        region: "us-east-1",
        environment: "env-123456",
        content_format: "JAR",
      };

      const result = await uploadArtifactModule.getPresignedUploadUrl(request);

      assert.strictEqual(result.upload_id, "test-upload-id");
      assert.strictEqual(result.upload_url, "https://storage.example.com/upload");
    });

    it("should throw error when not authenticated", async () => {
      tokenStub.returns({
        getDataPlaneToken: sandbox.stub().resolves(undefined),
      });

      const request = {
        cloud: "AWS",
        region: "us-east-1",
        environment: "env-123456",
        content_format: "JAR",
      };

      await assert.rejects(
        () => uploadArtifactModule.getPresignedUploadUrl(request),
        /Not authenticated to Confluent Cloud/,
      );
    });
  });

  describe("handleUploadToCloudProvider", () => {
    let uploadFileToAzureStub: sinon.SinonStub;
    let uploadFileToS3Stub: sinon.SinonStub;

    beforeEach(() => {
      const mockAzureResponse = new Response(null, { status: 200, statusText: "OK" });
      uploadFileToAzureStub = sandbox
        .stub(uploadToProvider, "uploadFileToAzure")
        .resolves(mockAzureResponse);

      const mockS3Response = new Response(null, { status: 204, statusText: "No Content" });
      uploadFileToS3Stub = sandbox
        .stub(uploadToProvider, "uploadFileToS3")
        .resolves(mockS3Response);

      sandbox.stub(uploadArtifactModule, "prepareUploadFileFromUri").resolves({
        blob: new Blob(["dummy"], { type: "application/java-archive" }),
        contentType: "application/java-archive",
      });
    });

    it("should upload to S3 with form data for AWS", async () => {
      const mockS3PresignedUrlResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
        api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
        kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
        upload_url: "https://test.s3.amazonaws.com/presigned-url",
        upload_form_data: {
          key: "test-key",
          policy: "base64-encoded-policy",
          "x-amz-algorithm": "AWS4-HMAC-SHA256",
          "x-amz-credential": "test-credential",
          "x-amz-date": "20240101T000000Z",
          "x-amz-signature": "test-signature",
          "x-amz-security-token": "test-security-token",
        },
      };

      await handleUploadToCloudProvider(mockAwsParams, mockS3PresignedUrlResponse);

      sinon.assert.calledOnce(uploadFileToS3Stub);
      sinon.assert.calledWith(uploadFileToS3Stub, {
        file: sinon.match.any, // The blob object
        presignedUrl: mockS3PresignedUrlResponse.upload_url,
        contentType: "application/java-archive",
        uploadFormData: mockS3PresignedUrlResponse.upload_form_data,
      });
    });

    it("should upload to Azure with presigned URL", async () => {
      const mockAzurePresignedUrlResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
        api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
        kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
        upload_url: "https://example.blob.core.windows.net/container/object?sig=mock",
      };

      await handleUploadToCloudProvider(mockAzureParams, mockAzurePresignedUrlResponse);

      sinon.assert.calledOnce(uploadFileToAzureStub);
      sinon.assert.calledWith(uploadFileToAzureStub, {
        file: sinon.match.any,
        presignedUrl: mockAzurePresignedUrlResponse.upload_url,
        contentType: "application/java-archive",
      });
      sinon.assert.notCalled(uploadFileToS3Stub);
    });

    it("should throw error when AWS upload form data is missing", async () => {
      const mockS3PresignedUrlResponseNoFormData: PresignedUploadUrlArtifactV1PresignedUrl200Response =
        {
          api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
          kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
          upload_url: "https://test.s3.amazonaws.com/presigned-url",
          // upload_form_data is missing
        };
      await assert.rejects(
        handleUploadToCloudProvider(mockAwsParams, mockS3PresignedUrlResponseNoFormData),
        /AWS upload form data is missing from presigned URL response/,
      );

      sinon.assert.notCalled(uploadFileToS3Stub);
    });
  });
  describe("buildCreateArtifactRequest", () => {
    it("should build the artifact request correctly", () => {
      const uploadId = "upload-id-123";
      const request = buildCreateArtifactRequest(mockAzureParams, uploadId);

      assert.deepStrictEqual(request, {
        cloud: mockAzureParams.cloud,
        region: mockAzureParams.region,
        environment: mockAzureParams.environment,
        display_name: mockAzureParams.artifactName,
        content_format: mockAzureParams.fileFormat.toUpperCase(),
        upload_source: {
          location: PRESIGNED_URL_LOCATION,
          upload_id: uploadId,
        },
      });
    });
  });
  describe("uploadArtifactToCCloud", () => {
    let tokenStub: sinon.SinonStub;
    let fetchStub: sinon.SinonStub;

    beforeEach(() => {
      // Stub token manager to return a token
      tokenStub = sandbox.stub(TokenManager, "getInstance");
      tokenStub.returns({
        getDataPlaneToken: sandbox.stub().resolves("test-token"),
      });
    });

    afterEach(() => {
      fetchStub?.restore();
    });

    it("should create artifact via API", async () => {
      const mockResponse = {
        id: "artifact-123",
        display_name: "test-artifact",
        cloud: "Azure",
        region: "australiaeast",
        environment: "env-123456",
      };

      fetchStub = sandbox.stub(global, "fetch").resolves({
        ok: true,
        status: 201,
        statusText: "Created",
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => mockResponse,
      } as Response);

      const result = await uploadArtifactModule.uploadArtifactToCCloud(
        mockAzureParams,
        "upload-123",
      );

      assert.strictEqual(result.id, "artifact-123");
      assert.strictEqual(result.display_name, "test-artifact");
    });

    it("should throw error when not authenticated", async () => {
      tokenStub.returns({
        getDataPlaneToken: sandbox.stub().resolves(undefined),
      });

      await assert.rejects(
        () => uploadArtifactModule.uploadArtifactToCCloud(mockAzureParams, "upload-123"),
        /Not authenticated to Confluent Cloud/,
      );
    });
  });

  describe("promptForFunctionAndClassName", () => {
    it("should accept well-formed input", async () => {
      const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      showInputBoxStub.onFirstCall().resolves("com.example.MyClass");
      showInputBoxStub.onSecondCall().resolves("MyClass");

      const result = await promptForFunctionAndClassName();

      sinon.assert.calledTwice(showInputBoxStub);

      assert.deepStrictEqual(result, {
        className: "com.example.MyClass",
        functionName: "MyClass",
      });
    });
  });

  describe("UDF input validation", () => {
    it("should reject malformed input for function name", async () => {
      const functionNameRegex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
      const result = uploadArtifactModule.validateUdfInput("123invalid", functionNameRegex);

      assert.strictEqual(
        result?.message,
        "Function name or class name must start with a letter or underscore and contain only letters, numbers, or underscores. Dots are allowed in class names.",
      );
    });

    it("should reject malformed input for class name", async () => {
      const classNameRegex = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
      const result = uploadArtifactModule.validateUdfInput("123 invalid", classNameRegex);

      assert.strictEqual(
        result?.message,
        "Function name or class name must start with a letter or underscore and contain only letters, numbers, or underscores. Dots are allowed in class names.",
      );
    });
  });

  describe("executeCreateFunction()", () => {
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let showInfoStub: sinon.SinonStub;

    beforeEach(() => {
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      // one environment with no pools by default
      stubbedLoader.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);
      stubbedLoader.executeBackgroundFlinkStatement.resolves([
        { created_at: JSON.stringify(new Date().toISOString()) },
      ]);

      showInfoStub = sandbox.stub(notifications, "showInfoNotificationWithButtons").resolves();
    });

    it("should show an info notification when UDF is created successfully", async () => {
      const fakeArtifact: FlinkArtifact = createFlinkArtifact();
      const functionName = "testFunction";
      const className = "com.test.TestClass";
      await executeCreateFunction(
        fakeArtifact,
        { functionName, className },
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      );

      sinon.assert.calledOnce(stubbedLoader.executeBackgroundFlinkStatement);
      sinon.assert.calledWith(
        stubbedLoader.executeBackgroundFlinkStatement,
        `CREATE FUNCTION \`${functionName}\` AS '${className}' USING JAR 'confluent-artifact://${fakeArtifact.id}';`,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        { timeout: 60000 },
      );
      sinon.assert.calledOnce(showInfoStub);
      sinon.assert.calledWith(showInfoStub, "testFunction function created successfully.");
    });
  });

  describe("getArtifactPatchParams", () => {
    it("should build patch payload correctly", async () => {
      const existingArtifact = createFlinkArtifact({
        id: "artifact-id",
        description: "old description",
        documentationLink: "https://old-link.com",
      });

      const showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
      const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      showQuickPickStub.onFirstCall().resolves({ value: "description" } as any);
      showInputBoxStub.onFirstCall().resolves("new description");

      showQuickPickStub.onSecondCall().resolves({ value: "documentationLink" } as any);
      showInputBoxStub.onSecondCall().resolves("https://new-link.com");

      showQuickPickStub.onThirdCall().resolves({ value: "complete" } as any);

      const patchPayload = await uploadArtifactModule.getArtifactPatchParams(existingArtifact);

      sinon.assert.calledThrice(showQuickPickStub);
      sinon.assert.calledTwice(showInputBoxStub);

      assert.deepStrictEqual(patchPayload, {
        description: "new description",
        documentation_link: "https://new-link.com",
      });
    });
  });

  describe("focusArtifactsInView", () => {
    let executeCommandStub: sinon.SinonStub;
    let stubbedViewProvider: sinon.SinonStubbedInstance<FlinkDatabaseViewProvider>;

    beforeEach(() => {
      executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");

      stubbedViewProvider = sandbox.createStubInstance(FlinkDatabaseViewProvider);
      sandbox.stub(FlinkDatabaseViewProvider, "getInstance").returns(stubbedViewProvider);
    });

    it("should execute command to focus the Flink Database view", async () => {
      await uploadArtifactModule.focusArtifactsInView(TEST_CCLOUD_FLINK_ARTIFACT);

      sinon.assert.calledOnce(executeCommandStub);
      sinon.assert.calledWith(executeCommandStub, "confluent-flink-database.focus");
    });

    it("should call revealResource on the FlinkDatabaseViewProvider with the provided artifact", async () => {
      await uploadArtifactModule.focusArtifactsInView(TEST_CCLOUD_FLINK_ARTIFACT);

      sinon.assert.calledOnce(stubbedViewProvider.revealResource);
      sinon.assert.calledWith(stubbedViewProvider.revealResource, TEST_CCLOUD_FLINK_ARTIFACT);
    });
  });
});
