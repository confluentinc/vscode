import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_LOCAL_KAFKA_CLUSTER, TEST_LOCAL_KAFKA_TOPIC } from "../tests/unit/testResources";
import { getTestExtensionContext } from "../tests/unit/testUtils";
import * as errors from "./errors";
import { CCloudResourceLoader } from "./loaders/ccloudResourceLoader";
import { CCloudFlinkComputePool } from "./models/flinkComputePool";
import { CCloudKafkaCluster } from "./models/kafkaCluster";
import { EnvironmentId, OrganizationId } from "./models/resource";
import { KafkaTopic } from "./models/topic";
import * as scaffold from "./scaffold";
import * as resourceManager from "./storage/resourceManager";

describe.only("resourceScaffoldProjectRequest tests", () => {
  let sandbox: sinon.SinonSandbox;
  let scaffoldProjectRequestStub: sinon.SinonStub;
  let mockResourceManager: any;
  let getClusterForTopicStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  let ccloudResourceLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let getOrganizationIdStub: sinon.SinonStub;

  const testOrgId = "test-org-id" as OrganizationId;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Stub scaffoldProjectRequest
    scaffoldProjectRequestStub = sandbox.stub(scaffold, "scaffoldProjectRequest").resolves();

    // Stub resource manager
    mockResourceManager = {
      getClusterForTopic: sandbox.stub(),
    };
    sandbox.stub(resourceManager, "getResourceManager").returns(mockResourceManager);
    getClusterForTopicStub = mockResourceManager.getClusterForTopic;

    // Stub error notification
    showErrorNotificationStub = sandbox.stub(errors, "showErrorNotificationWithButtons");

    // Stub CCloudResourceLoader
    ccloudResourceLoaderStub = sandbox.createStubInstance(CCloudResourceLoader);
    sandbox.stub(CCloudResourceLoader, "getInstance").returns(ccloudResourceLoaderStub);
    getOrganizationIdStub = ccloudResourceLoaderStub.getOrganizationId.resolves(testOrgId);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("KafkaCluster tests", () => {
    it("should call scaffoldProjectRequest with correct parameters for KafkaCluster", async () => {
      // Create a test CCloudKafkaCluster
      const testCluster = CCloudKafkaCluster.create({
        ...TEST_LOCAL_KAFKA_CLUSTER,
        bootstrapServers: "kafka:9092",
        provider: "GCP",
        region: "us-east-1",
        environmentId: "test-env-id" as EnvironmentId,
      });

      // Call the function
      await scaffold.resourceScaffoldProjectRequest(testCluster);

      // Check that scaffoldProjectRequest was called with the correct parameters
      assert.strictEqual(scaffoldProjectRequestStub.calledOnce, true);
      assert.deepStrictEqual(scaffoldProjectRequestStub.firstCall.args[0], {
        bootstrap_server: "kafka:9092-without-protocol",
        cc_bootstrap_server: "kafka:9092-without-protocol",
        templateType: "kafka",
      });
    });
  });

  describe("KafkaTopic tests", () => {
    it("should call scaffoldProjectRequest with correct parameters for KafkaTopic with associated cluster", async () => {
      // Create a test KafkaTopic
      const testTopic = KafkaTopic.create({
        ...TEST_LOCAL_KAFKA_TOPIC,
        name: "test-topic",
      });

      // Create a test CCloudKafkaCluster that will be returned by getClusterForTopic
      const testCluster = CCloudKafkaCluster.create({
        ...TEST_LOCAL_KAFKA_CLUSTER,
        bootstrapServers: "kafka:9092",
        provider: "AWS",
        region: "us-west-2",
        environmentId: "test-env-id" as EnvironmentId,
      });

      // Configure getClusterForTopic to return the test cluster
      getClusterForTopicStub.withArgs(testTopic).resolves(testCluster);

      // Call the function
      await scaffold.resourceScaffoldProjectRequest(testTopic);

      // Check that getClusterForTopic was called with the correct parameter
      assert.strictEqual(getClusterForTopicStub.calledOnce, true);
      assert.strictEqual(getClusterForTopicStub.firstCall.args[0], testTopic);

      // Check that scaffoldProjectRequest was called with the correct parameters
      assert.strictEqual(scaffoldProjectRequestStub.calledOnce, true);
      assert.deepStrictEqual(scaffoldProjectRequestStub.firstCall.args[0], {
        bootstrap_server: "kafka:9092-without-protocol",
        cc_bootstrap_server: "kafka:9092-without-protocol",
        cc_topic: "test-topic",
        topic: "test-topic",
        templateType: "kafka",
      });

      // Verify the error notification was not shown
      assert.strictEqual(showErrorNotificationStub.called, false);
    });

    it("should show error notification when no cluster is found for KafkaTopic", async () => {
      // Create a test KafkaTopic
      const testTopic = KafkaTopic.create({
        ...TEST_LOCAL_KAFKA_TOPIC,
        name: "test-topic-no-cluster",
      });

      // Configure getClusterForTopic to return null (no cluster found)
      getClusterForTopicStub.withArgs(testTopic).resolves(null);

      // Call the function
      await scaffold.resourceScaffoldProjectRequest(testTopic);

      // Check that getClusterForTopic was called with the correct parameter
      assert.strictEqual(getClusterForTopicStub.calledOnce, true);
      assert.strictEqual(getClusterForTopicStub.firstCall.args[0], testTopic);

      // Verify scaffoldProjectRequest was not called
      assert.strictEqual(scaffoldProjectRequestStub.called, false);

      // Verify the error notification was shown with the correct message
      assert.strictEqual(showErrorNotificationStub.calledOnce, true);
      assert.strictEqual(
        showErrorNotificationStub.firstCall.args[0],
        'Unable to find Kafka cluster for topic "test-topic-no-cluster".',
      );
    });
  });

  describe("CCloudFlinkComputePool tests", () => {
    it("should call scaffoldProjectRequest with correct parameters for CCloudFlinkComputePool", async () => {
      // Create a test CCloudFlinkComputePool
      const testComputePool: CCloudFlinkComputePool = new CCloudFlinkComputePool({
        id: "test-compute-pool-id",
        name: "Test Compute Pool",
        environmentId: "test-env-id" as EnvironmentId,
        region: "us-west-2",
        provider: "AWS",
        maxCfu: 5,
      });

      // Call the function
      await scaffold.resourceScaffoldProjectRequest(testComputePool);

      // Check that getOrganizationId was called
      assert.strictEqual(getOrganizationIdStub.calledOnce, true);

      // Check that scaffoldProjectRequest was called with the correct parameters
      assert.strictEqual(scaffoldProjectRequestStub.calledOnce, true);
      assert.deepStrictEqual(scaffoldProjectRequestStub.firstCall.args[0], {
        cc_environment_id: "test-env-id",
        cc_organization_id: testOrgId,
        cloud_region: "us-west-2",
        cloud_provider: "AWS",
        cc_compute_pool_id: "test-compute-pool-id",
        templateType: "flink",
      });
    });
  });

  it("should not call scaffoldProjectRequest when no item is provided", async () => {
    // Call the function with no item
    await scaffold.resourceScaffoldProjectRequest();

    // Verify scaffoldProjectRequest was not called
    assert.strictEqual(scaffoldProjectRequestStub.called, false);
  });
});
