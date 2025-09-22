import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { eventEmitterStubs } from "../../../tests/stubs/emitters";
import { getSidecarStub } from "../../../tests/stubs/sidecar";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../../tests/unit/testResources/flinkComputePool";
import {
  ArtifactV1FlinkArtifactMetadataFromJSON,
  FlinkArtifactsArtifactV1Api,
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum,
  PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum,
} from "../../clients/flinkArtifacts";
import { PresignedUrlsArtifactV1Api } from "../../clients/flinkArtifacts/apis/PresignedUrlsArtifactV1Api";
import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../../clients/flinkArtifacts/models/PresignedUploadUrlArtifactV1PresignedUrlRequest";
import { FcpmV2RegionListDataInner } from "../../clients/flinkComputePool/models/FcpmV2RegionListDataInner";
import { ConnectionType } from "../../clients/sidecar";
import { FlinkArtifact } from "../../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { CCloudKafkaCluster } from "../../models/kafkaCluster";
import { CloudProvider, ConnectionId, EnvironmentId } from "../../models/resource";
import * as notifications from "../../notifications";
import * as cloudProviderRegions from "../../quickpicks/cloudProviderRegions";
import * as environments from "../../quickpicks/environments";
import * as sidecar from "../../sidecar";
import * as fsWrappers from "../../utils/fsWrappers";
import * as uploadArtifactModule from "./uploadArtifactOrUDF";
import {
  buildCreateArtifactRequest,
  getPresignedUploadUrl,
  handleUploadToCloudProvider,
  prepareUploadFileFromUri,
  PRESIGNED_URL_LOCATION,
  promptForArtifactUploadParams,
  promptForFunctionAndClassName,
  uploadArtifactToCCloud,
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
    it("should return a presigned upload URL", async () => {
      const mockSidecarHandle = sandbox.createStubInstance(sidecar.SidecarHandle);
      const mockResponse = {
        upload_url: "https://example.com/presigned-url",
        api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
        kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
      };

      const mockPresignedClient = sandbox.createStubInstance(PresignedUrlsArtifactV1Api);
      mockPresignedClient.presignedUploadUrlArtifactV1PresignedUrl.resolves(mockResponse);

      mockSidecarHandle.getFlinkPresignedUrlsApi.returns(mockPresignedClient);

      sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

      const mockPresignedUploadUrlRequest: PresignedUploadUrlArtifactV1PresignedUrlRequest = {
        content_format: "application/java-archive",
        cloud: "azure",
        region: "australiaeast",
        environment: "env-123456",
      };

      const response = await getPresignedUploadUrl(mockPresignedUploadUrlRequest);
      assert.deepStrictEqual(response, {
        api_version: "artifact/v1",
        kind: "PresignedUrl",
        upload_url: "https://example.com/presigned-url",
      });
    });
  });

  describe("promptForArtifactUploadParams", () => {
    let flinkCcloudEnvironmentQuickPickStub: sinon.SinonStub;
    let cloudProviderRegionQuickPickStub: sinon.SinonStub;
    const fakeCloudProviderRegion: FcpmV2RegionListDataInner = {
      id: "australiaeast",
      cloud: "temp", //Change in below tests
      display_name: "Australia East",
      region_name: "australiaeast",
      metadata: {} as any,
      http_endpoint: "",
    };
    const mockEnvironment = TEST_CCLOUD_ENVIRONMENT;
    const mockFileName = "mock-file";
    const mockFileUri = vscode.Uri.file(`/path/to/${mockFileName}.jar`);
    beforeEach(() => {
      flinkCcloudEnvironmentQuickPickStub = sandbox.stub(
        environments,
        "flinkCcloudEnvironmentQuickPick",
      );
      cloudProviderRegionQuickPickStub = sandbox.stub(
        cloudProviderRegions,
        "cloudProviderRegionQuickPick",
      );
    });
    it("should return undefined if environment is not selected", async () => {
      const result = await promptForArtifactUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should return undefined if region is not selected", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(TEST_CCLOUD_ENVIRONMENT);
      const result = await promptForArtifactUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should show error and return undefined for GCP cloud provider", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(TEST_CCLOUD_ENVIRONMENT);

      const mockGCPRegion = {
        id: "us-central1",
        provider: "GCP" as CloudProvider,
        displayName: "US Central 1",
        regionName: "us-central1",
        region: "us-central1",
      };

      cloudProviderRegionQuickPickStub.resolves(mockGCPRegion);

      const errorNotificationStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();

      const result = await promptForArtifactUploadParams();

      sinon.assert.calledWithMatch(
        errorNotificationStub,
        `Upload Artifact cancelled: Unsupported cloud provider: ${mockGCPRegion.provider}`,
      );

      assert.strictEqual(result, undefined);
    });

    it("should silently return if user cancels the file selection", async () => {
      sandbox.stub(vscode.window, "showOpenDialog").resolves([]);
      const result = await promptForArtifactUploadParams();
      assert.strictEqual(result, undefined);
    });

    it("should prefill artifact name with file base name when selecting a file", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);
      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AZURE",
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);

      const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox").resolves(mockFileName);

      const result = await promptForArtifactUploadParams();

      sinon.assert.calledWithMatch(showInputBoxStub, sinon.match({ value: mockFileName }));
      assert.deepStrictEqual(result?.selectedFile, mockFileUri);
    });

    it("returns the correct Artifact upload parameters for Azure", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);
      // reset the region quick pick stub to return a valid Azure region
      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AZURE",
        region: fakeCloudProviderRegion.region_name,
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);

      sandbox.stub(vscode.window, "showInputBox").resolves("test-artifact");

      const result = await promptForArtifactUploadParams();

      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "Azure",
        region: fakeCloudProviderRegion.region_name,
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });

    it("returns the correct Artifact upload parameters for AWS", async () => {
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);

      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AWS",
        region: fakeCloudProviderRegion.region_name,
      });

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);
      sandbox.stub(vscode.window, "showInputBox").resolves("test-artifact");

      const result = await promptForArtifactUploadParams();

      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "AWS",
        region: fakeCloudProviderRegion.region_name,
        artifactName: "test-artifact",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });

    it("should use provided CCloudFlinkComputePool context without prompting for environment/region", async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);
      sandbox.stub(vscode.window, "showInputBox").resolves(mockFileName);

      const result = await promptForArtifactUploadParams(pool);

      // environment and cloud/region should be derived from the item, not from quick picks
      sinon.assert.notCalled(flinkCcloudEnvironmentQuickPickStub);
      sinon.assert.notCalled(cloudProviderRegionQuickPickStub);

      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "AWS",
        region: "us-west-2",
        artifactName: "mock-file",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });

    it("should use provided CCloudKafkaCluster context without prompting for environment/region", async () => {
      const cluster: CCloudKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

      sandbox.stub(vscode.window, "showOpenDialog").resolves([mockFileUri]);
      sandbox.stub(vscode.window, "showInputBox").resolves("cluster-artifact");

      const result = await promptForArtifactUploadParams(cluster);

      sinon.assert.notCalled(flinkCcloudEnvironmentQuickPickStub);
      sinon.assert.notCalled(cloudProviderRegionQuickPickStub);

      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "AWS",
        region: "us-west-2",
        artifactName: "cluster-artifact",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });

    it("should accept a vscode.Uri item and not prompt for file selection", async () => {
      // environment and region picks still happen when URI is provided
      flinkCcloudEnvironmentQuickPickStub.resolves(mockEnvironment);
      cloudProviderRegionQuickPickStub.resolves({
        ...fakeCloudProviderRegion,
        provider: "AWS",
        region: fakeCloudProviderRegion.region_name,
      });
      sandbox.stub(vscode.window, "showInputBox").resolves("mock-file");
      const filePicker = sandbox.stub(vscode.window, "showOpenDialog");

      const result = await promptForArtifactUploadParams(mockFileUri);
      // file picker should not be called if we provided a URI
      sinon.assert.notCalled(filePicker);
      assert.deepStrictEqual(result, {
        environment: mockEnvironment.id,
        cloud: "AWS",
        region: fakeCloudProviderRegion.region_name,
        artifactName: "mock-file",
        fileFormat: "jar",
        selectedFile: mockFileUri,
      });
    });
  });

  describe("handleUploadToCloudProvider", () => {
    const mockPresignedUrlResponse: PresignedUploadUrlArtifactV1PresignedUrl200Response = {
      api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
      kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
      upload_url: "https://example.com/presigned-url",
    };
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
    it("should log the message confirming the upload for Azure", async () => {
      const mockProgress = {
        report: sandbox.stub(),
      };

      const mockToken = {
        isCancellationRequested: false,
        onCancellationRequested: sandbox.stub(),
      };

      const withProgressStub = sandbox.stub(vscode.window, "withProgress");
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(mockProgress as any, mockToken as any);
      });

      await handleUploadToCloudProvider(mockAzureParams, mockPresignedUrlResponse);

      sinon.assert.calledOnce(uploadFileToAzureStub);
      sinon.assert.calledWith(uploadFileToAzureStub, {
        file: sinon.match.any, // The blob object
        presignedUrl: mockPresignedUrlResponse.upload_url,
        contentType: "application/java-archive",
      });

      sinon.assert.calledWith(mockProgress.report, { message: "Preparing file..." });
      sinon.assert.calledWith(mockProgress.report, { message: "Uploading to Azure storage..." });
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

      const mockProgress = {
        report: sandbox.stub(),
      };

      const mockToken = {
        isCancellationRequested: false,
        onCancellationRequested: sandbox.stub(),
      };

      const withProgressStub = sandbox.stub(vscode.window, "withProgress");
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(mockProgress as any, mockToken as any);
      });

      await handleUploadToCloudProvider(mockAwsParams, mockS3PresignedUrlResponse);

      sinon.assert.calledOnce(uploadFileToS3Stub);
      sinon.assert.calledWith(uploadFileToS3Stub, {
        file: sinon.match.any, // The blob object
        presignedUrl: mockS3PresignedUrlResponse.upload_url,
        contentType: "application/java-archive",
        uploadFormData: mockS3PresignedUrlResponse.upload_form_data,
      });

      sinon.assert.calledWith(mockProgress.report, { message: "Preparing file..." });
      sinon.assert.calledWith(mockProgress.report, { message: "Uploading to AWS storage..." });
    });

    it("should throw error when AWS upload form data is missing", async () => {
      const mockS3PresignedUrlResponseNoFormData: PresignedUploadUrlArtifactV1PresignedUrl200Response =
        {
          api_version: PresignedUploadUrlArtifactV1PresignedUrl200ResponseApiVersionEnum.ArtifactV1,
          kind: PresignedUploadUrlArtifactV1PresignedUrl200ResponseKindEnum.PresignedUrl,
          upload_url: "https://test.s3.amazonaws.com/presigned-url",
          // upload_form_data is missing
        };

      const mockProgress = {
        report: sandbox.stub(),
      };

      const mockToken = {
        isCancellationRequested: false,
        onCancellationRequested: sandbox.stub(),
      };

      const withProgressStub = sandbox.stub(vscode.window, "withProgress");
      withProgressStub.callsFake(async (options, callback) => {
        return await callback(mockProgress as any, mockToken as any);
      });

      await assert.rejects(
        handleUploadToCloudProvider(mockAwsParams, mockS3PresignedUrlResponseNoFormData),
        /AWS upload form data is missing from presigned URL response/,
      );

      sinon.assert.notCalled(uploadFileToS3Stub);
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
      let stubbedFlinkArtifactsApi: sinon.SinonStubbedInstance<FlinkArtifactsArtifactV1Api>;
      let stubbedSidecarHandle: ReturnType<typeof getSidecarStub>;
      let stubbedArtifactsChangedEmitter: sinon.SinonStubbedInstance<vscode.EventEmitter<any>>;

      beforeEach(() => {
        stubbedFlinkArtifactsApi = sandbox.createStubInstance(FlinkArtifactsArtifactV1Api);
        stubbedSidecarHandle = getSidecarStub(sandbox);
        stubbedSidecarHandle.getFlinkArtifactsApi.returns(stubbedFlinkArtifactsApi);

        const stubbedEventEmitters = eventEmitterStubs(sandbox);
        stubbedArtifactsChangedEmitter = stubbedEventEmitters.artifactsChanged!;
      });

      it("should upload the artifact to Confluent Cloud", async () => {
        const mockUploadId = "upload-id-123";
        stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact.resolves({
          id: "artifact-id-123",
          cloud: "",
          region: "",
          environment: "",
          display_name: "",
        });

        await uploadArtifactToCCloud(mockAzureParams, mockUploadId);

        sinon.assert.calledOnce(stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact);
        sinon.assert.calledWith(stubbedFlinkArtifactsApi.createArtifactV1FlinkArtifact, {
          CreateArtifactV1FlinkArtifactRequest: buildCreateArtifactRequest(
            mockAzureParams,
            mockUploadId,
          ),
          cloud: mockAzureParams.cloud,
          region: mockAzureParams.region,
        });
        sinon.assert.called(stubbedArtifactsChangedEmitter.fire);
        sinon.assert.calledWith(stubbedArtifactsChangedEmitter.fire, {
          environmentId: mockAzureParams.environment as EnvironmentId,
          provider: mockAzureParams.cloud,
          region: mockAzureParams.region,
        });
      });
    });
  });
  describe("promptForFunctionAndClassName", () => {
    const selectedArtifact = new FlinkArtifact({
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

    it("should accept well-formed input", async () => {
      const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      showInputBoxStub.onFirstCall().resolves("myFunction");
      showInputBoxStub.onSecondCall().resolves("com.example.MyClass");

      const result = await promptForFunctionAndClassName(selectedArtifact);

      sinon.assert.calledTwice(showInputBoxStub);

      assert.deepStrictEqual(result, {
        functionName: "myFunction",
        className: "com.example.MyClass",
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
});
