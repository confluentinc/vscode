import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_KAFKA_CLUSTER, TEST_CCLOUD_KAFKA_TOPIC } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { CCloudResourceLoader } from "../loaders";
import * as notifications from "../notifications";
import {
  resourceScaffoldProjectCommand,
  scaffoldFlinkArtifactCommand,
  scaffoldProjectCommand,
} from "./scaffold";
import * as scaffoldUtils from "./utils/scaffoldUtils";

describe("commands/scaffold.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let scaffoldProjectRequestStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    scaffoldProjectRequestStub = sandbox.stub(scaffoldUtils, "scaffoldProjectRequest");
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("scaffoldProjectCommand", () => {
    it("should call scaffoldProjectRequest without arguments", async () => {
      await scaffoldProjectCommand();
      sinon.assert.calledOnceWithExactly(scaffoldProjectRequestStub);
    });
  });

  describe("scaffoldFlinkArtifactCommand", () => {
    it("should call scaffoldProjectRequest with templateType and telemetry source 'artifact'", async () => {
      await scaffoldFlinkArtifactCommand();
      sinon.assert.calledOnceWithExactly(
        scaffoldProjectRequestStub,
        { templateType: "artifact" },
        "artifact",
      );
    });
  });

  describe("resourceScaffoldProjectCommand", () => {
    let stubbedResourceLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    const expectedBootstrapServers = TEST_CCLOUD_KAFKA_CLUSTER.bootstrapServers.replace(
      /^(PLAINTEXT|SSL|SASL_PLAINTEXT|SASL_SSL):\/\//,
      "",
    );

    beforeEach(() => {
      stubbedResourceLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    it("should call scaffoldProjectRequest with correct parameters for KafkaCluster", async () => {
      await resourceScaffoldProjectCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      sinon.assert.calledOnceWithExactly(
        scaffoldProjectRequestStub,
        {
          bootstrap_server: expectedBootstrapServers,
          cc_bootstrap_server: expectedBootstrapServers,
          templateType: "kafka",
        },
        "cluster",
      );
    });

    it("should call scaffoldProjectRequest with correct parameters for KafkaTopic", async () => {
      stubbedResourceLoader.getKafkaClustersForEnvironmentId
        .withArgs(TEST_CCLOUD_KAFKA_TOPIC.environmentId)
        .resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

      await resourceScaffoldProjectCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.calledOnceWithExactly(
        scaffoldProjectRequestStub,
        {
          bootstrap_server: expectedBootstrapServers,
          cc_bootstrap_server: expectedBootstrapServers,
          cc_topic: TEST_CCLOUD_KAFKA_TOPIC.name,
          topic: TEST_CCLOUD_KAFKA_TOPIC.name,
          templateType: "kafka",
        },
        "topic",
      );
    });

    it("should call scaffoldProjectRequest with correct parameters for CCloudFlinkComputePool", async () => {
      await resourceScaffoldProjectCommand(TEST_CCLOUD_FLINK_COMPUTE_POOL);

      sinon.assert.calledOnceWithExactly(
        scaffoldProjectRequestStub,
        {
          cc_environment_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.environmentId,
          cc_organization_id: undefined,
          cloud_region: TEST_CCLOUD_FLINK_COMPUTE_POOL.region,
          cloud_provider: TEST_CCLOUD_FLINK_COMPUTE_POOL.provider,
          cc_compute_pool_id: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
          templateType: "flink",
        },
        "compute pool",
      );
    });

    it("should show an error notification if Kafka cluster for topic is not found", async () => {
      const showErrorNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showErrorNotificationWithButtons",
      );

      stubbedResourceLoader.getKafkaClustersForEnvironmentId
        .withArgs(TEST_CCLOUD_KAFKA_TOPIC.environmentId)
        .resolves([]); // No clusters returned

      await resourceScaffoldProjectCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.notCalled(scaffoldProjectRequestStub);
      sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
      sinon.assert.calledWithExactly(
        showErrorNotificationWithButtonsStub,
        `Unable to find Kafka cluster for topic "${TEST_CCLOUD_KAFKA_TOPIC.name}".`,
      );
    });
  });
});
