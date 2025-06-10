import * as assert from "assert";
import sinon from "sinon";
import { ResourceLoader } from "../../loaders";
import * as notificationsModule from "../../notifications";
import * as projectGenModule from "../../projectGeneration";
import { resourceScaffoldProjectRequest } from "../../projectGeneration/commands";

describe.only("resourceScaffoldProjectRequest", function () {
  let sandbox: sinon.SinonSandbox;
  let scaffoldProjectRequestStub: sinon.SinonStub;
  let showErrorNotificationWithButtonsStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    scaffoldProjectRequestStub = sandbox.stub(projectGenModule, "scaffoldProjectRequest");
    showErrorNotificationWithButtonsStub = sandbox.stub(
      notificationsModule,
      "showErrorNotificationWithButtons",
    );
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should handle KafkaCluster resource", async function () {
    const mockCluster = {
      id: "cluster-123",
      name: "test-cluster",
      parent: { id: "org-123" },
      bootstrap: "https://test-bootstrap:9092",
      getEnvironments: sandbox.stub(),
      getKafkaClustersForEnvironmentId: sandbox.stub(),
      getTopicsForCluster: sandbox.stub(),
      getSchemaRegistries: sandbox.stub(),
    } as unknown as ResourceLoader;

    await resourceScaffoldProjectRequest(mockCluster);

    assert.ok(scaffoldProjectRequestStub.calledOnce);
    assert.deepStrictEqual(scaffoldProjectRequestStub.firstCall.args[0], {
      templateCollection: "vscode",
      templateName: "kafka",
      clusterId: "cluster-123",
      organizationId: "org-123",
      clusterName: "test-cluster",
      bootstrap: "test-bootstrap:9092",
    });
  });

  it("should handle KafkaTopic resource", async function () {
    const mockTopic = {
      name: "test-topic",
      parent: {
        id: "cluster-123",
        parent: { id: "org-123" },
        bootstrap: "https://test-bootstrap:9092",
      },
      getEnvironments: sandbox.stub(),
      getKafkaClustersForEnvironmentId: sandbox.stub(),
      getTopicsForCluster: sandbox.stub(),
      getSchemaRegistries: sandbox.stub(),
    } as unknown as ResourceLoader;

    await resourceScaffoldProjectRequest(mockTopic);

    assert.ok(scaffoldProjectRequestStub.calledOnce);
    assert.deepStrictEqual(scaffoldProjectRequestStub.firstCall.args[0], {
      templateCollection: "vscode",
      templateName: "kafka",
      topicName: "test-topic",
      clusterId: "cluster-123",
      organizationId: "org-123",
      bootstrap: "test-bootstrap:9092",
    });
  });

  it("should handle CCloudFlinkComputePool resource", async function () {
    const mockComputePool = {
      id: "pool-123",
      name: "test-pool",
      parent: { id: "org-123" },
      getEnvironments: sandbox.stub(),
      getKafkaClustersForEnvironmentId: sandbox.stub(),
      getTopicsForCluster: sandbox.stub(),
      getSchemaRegistries: sandbox.stub(),
    } as unknown as ResourceLoader;

    await resourceScaffoldProjectRequest(mockComputePool);

    assert.ok(scaffoldProjectRequestStub.calledOnce);
    assert.deepStrictEqual(scaffoldProjectRequestStub.firstCall.args[0], {
      templateCollection: "vscode",
      templateName: "flink",
      computePoolId: "pool-123",
      organizationId: "org-123",
      computePoolName: "test-pool",
    });
  });

  it("should show error for unsupported resource type", async function () {
    const mockUnsupportedResource = {
      getEnvironments: sandbox.stub(),
      getKafkaClustersForEnvironmentId: sandbox.stub(),
      getTopicsForCluster: sandbox.stub(),
      getSchemaRegistries: sandbox.stub(),
    } as unknown as ResourceLoader;

    await resourceScaffoldProjectRequest(mockUnsupportedResource);

    assert.ok(showErrorNotificationWithButtonsStub.calledOnce);
    assert.ok(
      showErrorNotificationWithButtonsStub.calledWith(
        "Scaffolding is not supported for this resource type",
        { OK: () => {} },
      ),
    );
    assert.ok(scaffoldProjectRequestStub.notCalled);
  });
});
