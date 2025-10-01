import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../../tests/unit/testResources";
import * as loaders from "../../loaders";
import { CloudProvider } from "../../models/resource";
import * as regionsQuickPick from "../../quickpicks/cloudProviderRegions";
import * as environmentsQuickPick from "../../quickpicks/environments";
import { FlinkDatabaseViewProvider } from "../../viewProviders/flinkDatabase";
import { artifactUploadQuickPickForm } from "./artifactUploadForm";

describe("commands/utils/artifactUploadForm", () => {
  let sandbox: sinon.SinonSandbox;
  let showQuickPickStub: sinon.SinonStub;
  let ccloudLoader: sinon.SinonStubbedInstance<loaders.CCloudResourceLoader>;
  let viewProviderStub: FlinkDatabaseViewProvider;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
    ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
    ccloudLoader.getEnvironment
      .withArgs(TEST_CCLOUD_ENVIRONMENT.environmentId)
      .resolves(TEST_CCLOUD_ENVIRONMENT);
    viewProviderStub = FlinkDatabaseViewProvider.getInstance();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it("should return undefined when the user cancels on the top-level quick pick", async () => {
    // Immediately simulate cancel (user ESC / closes picker)
    showQuickPickStub.resolves(undefined);

    const result = await artifactUploadQuickPickForm();

    sinon.assert.calledOnce(showQuickPickStub);
    assert.strictEqual(result, undefined, "Expected undefined when user cancels the form");
  });

  it("should not show completion option before required fields are selected", async () => {
    const tempUri = vscode.Uri.file("/tmp/example-artifact.jar");

    // Simulate cancel again
    showQuickPickStub.resolves(undefined);
    await artifactUploadQuickPickForm(tempUri);

    const firstMenuItems = showQuickPickStub.getCall(0).args[0];
    const completeItem = firstMenuItems.find((i: any) => i.value === "complete");
    assert.strictEqual(
      completeItem,
      undefined,
      "Complete option should not appear before required fields selected",
    );
  });

  it("should complete happy path and return ArtifactUploadParams", async () => {
    const tempUri = vscode.Uri.file("/tmp/happy-artifact.jar");
    ccloudLoader.getFlinkDatabases.resolves([]);

    // Simulates the sequence of user actions in order of appearance in menu:
    showQuickPickStub
      // Top-level -> choose environment
      .onCall(0)
      .resolves({ value: "environment" })
      // Top-level -> choose cloudRegion
      .onCall(1)
      .resolves({ value: "cloudRegion" })
      // Top-level -> choose file
      .onCall(2)
      .resolves({ value: "file" })
      // Top-level -> choose artifactName
      .onCall(3)
      .resolves({ value: "artifactName" })
      // Top-level -> choose complete
      .onCall(4)
      .resolves({ value: "complete" });

    // Selecting environment
    sandbox
      .stub(environmentsQuickPick, "flinkCcloudEnvironmentQuickPick")
      .resolves(TEST_CCLOUD_ENVIRONMENT);

    sandbox.stub(regionsQuickPick, "flinkDatabaseRegionsQuickPick").resolves({
      provider: "AWS",
      region: "us-east-1",
    });

    // Selecting JAR
    sandbox.stub(vscode.window, "showOpenDialog").resolves([tempUri]);

    const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
    // Artifact name
    showInputBoxStub.onFirstCall().resolves("happy-artifact");

    const params = await artifactUploadQuickPickForm();
    assert.ok(params, "Expected params to be returned for happy path");
    assert.deepStrictEqual(
      {
        environment: params?.environment,
        cloud: params?.cloud,
        region: params?.region,
        artifactName: params?.artifactName,
        fileFormat: params?.fileFormat,
        fileEndsWith: params?.selectedFile.fsPath.endsWith("happy-artifact.jar"),
      },
      {
        environment: TEST_CCLOUD_ENVIRONMENT.environmentId,
        cloud: CloudProvider.AWS,
        region: "us-east-1",
        artifactName: "happy-artifact",
        fileFormat: "jar",
        fileEndsWith: true,
      },
    );
  });

  it("should pre-populate region and provider from selected Flink database", async () => {
    // Cancel right away - we only want to inspect menu state
    showQuickPickStub.resolves(undefined);
    const database = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
    viewProviderStub["resource"] = database;

    await artifactUploadQuickPickForm();
    const firstMenuItems = showQuickPickStub.getCall(0).args[0];
    const regionItem = firstMenuItems.find((i: any) => i.value === "cloudRegion");
    assert.ok(regionItem, "Cloud region item should exist");
    assert.strictEqual(regionItem.description, "AWS - us-west-2");
  });

  it("should pre-populate file and artifact name from provided Uri", async () => {
    const tempUri = vscode.Uri.file("/tmp/example-artifact.jar");

    const result = await artifactUploadQuickPickForm(tempUri);

    sinon.assert.calledOnce(showQuickPickStub);
    assert.strictEqual(result, undefined, "Expected undefined due to cancellation");

    const firstMenuItems = showQuickPickStub.getCall(0).args[0];
    assert.ok(
      Array.isArray(firstMenuItems),
      "First argument to showQuickPick should be an array of menu items",
    );

    const fileItem = firstMenuItems.find((i) => i.value === "file");
    const nameItem = firstMenuItems.find((i) => i.value === "artifactName");

    assert.ok(fileItem, "File menu item should exist");
    assert.ok(nameItem, "Artifact name menu item should exist");
    assert.strictEqual(
      fileItem.description,
      "example-artifact.jar",
      "File description should show jar filename",
    );
    assert.strictEqual(
      nameItem.description,
      "example-artifact",
      "Artifact name should be derived from filename",
    );
  });

  it("should pre-populate environment and cloud/region when a Kafka cluster item is passed", async () => {
    // Cancel right away - we only want to inspect menu state
    showQuickPickStub.resolves(undefined);
    const cluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;
    const result = await artifactUploadQuickPickForm(cluster);
    assert.strictEqual(result, undefined, "Expected undefined due to cancellation");

    sinon.assert.calledOnce(ccloudLoader.getEnvironment);
    const firstMenuItems = showQuickPickStub.getCall(0).args[0];
    const envItem = firstMenuItems.find((i: any) => i.value === "environment");
    const regionItem = firstMenuItems.find((i: any) => i.value === "cloudRegion");
    assert.ok(envItem, "Environment item should exist");
    assert.ok(regionItem, "Cloud region item should exist");
    assert.strictEqual(envItem.description, "test-cloud-environment (env-abc123)");
    assert.strictEqual(regionItem.description, "AWS - us-west-2");
  });
});
