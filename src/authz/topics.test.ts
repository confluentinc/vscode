import * as assert from "assert";
import sinon from "sinon";
import * as ccloudUtils from "../authn/utils";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources/kafkaCluster";
import { createKafkaTopic } from "../../tests/unit/testResources/topic";
import { ConnectionType } from "../connections";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { HttpError } from "../proxy/httpClient";
import * as kafkaRestProxy from "../proxy/kafkaRestProxy";
import * as resourceManagerModule from "../storage/resourceManager";
import { fetchTopicAuthorizedOperations } from "./topics";

describe("authz.topics", function () {
  let sandbox: sinon.SinonSandbox;
  let getCCloudAuthSessionStub: sinon.SinonStub;
  let getResourceManagerStub: sinon.SinonStub;
  let kafkaRestProxyStub: sinon.SinonStubbedInstance<kafkaRestProxy.KafkaRestProxy>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // Stub getCCloudAuthSession
    getCCloudAuthSessionStub = sandbox.stub(ccloudUtils, "getCCloudAuthSession");

    // Stub ResourceManager
    getResourceManagerStub = sandbox.stub(resourceManagerModule, "getResourceManager");

    // Create a stubbed KafkaRestProxy instance
    kafkaRestProxyStub = sandbox.createStubInstance(kafkaRestProxy.KafkaRestProxy);

    // Stub the KafkaRestProxy constructor to return our stubbed instance
    sandbox
      .stub(kafkaRestProxy, "KafkaRestProxy")
      .returns(kafkaRestProxyStub as unknown as kafkaRestProxy.KafkaRestProxy);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("fetchTopicAuthorizedOperations() should return cached operations for a local topic", async function () {
    // Local topics should return cached operations without making API calls
    const testTopic = createKafkaTopic({
      connectionId: LOCAL_CONNECTION_ID,
      connectionType: ConnectionType.Local,
      environmentId: TEST_LOCAL_KAFKA_CLUSTER.environmentId,
      clusterId: TEST_LOCAL_KAFKA_CLUSTER.id,
      name: "test-local-topic",
      operations: ["READ", "WRITE"],
    });

    const operations = await fetchTopicAuthorizedOperations(testTopic);
    assert.deepStrictEqual(operations, ["READ", "WRITE"]);

    // Should not have tried to get auth session for local topics
    sinon.assert.notCalled(getCCloudAuthSessionStub);
  });

  describe("CCloud topics", function () {
    it("should return fresh operations from API when available", async function () {
      // Setup auth session
      getCCloudAuthSessionStub.resolves({ accessToken: "test-token" });

      // Setup resource manager with cluster info
      const mockCluster = {
        id: TEST_CCLOUD_KAFKA_CLUSTER.id,
        bootstrapServers: "pkc-test.us-west-2.aws.confluent.cloud:9092",
      };
      getResourceManagerStub.returns({
        getKafkaClustersForEnvironmentId: sandbox.stub().resolves([mockCluster]),
      });

      // Setup proxy to return fresh authorized operations
      kafkaRestProxyStub.getTopic.resolves({
        topic_name: "test-ccloud-topic",
        authorized_operations: ["READ", "WRITE", "DELETE", "CREATE"],
      } as kafkaRestProxy.TopicData);

      const testTopic = createKafkaTopic({
        connectionId: CCLOUD_CONNECTION_ID,
        connectionType: ConnectionType.Ccloud,
        environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
        name: "test-ccloud-topic",
        operations: ["READ"], // Cached operations are different
      });

      const operations = await fetchTopicAuthorizedOperations(testTopic);
      assert.deepStrictEqual(operations, ["READ", "WRITE", "DELETE", "CREATE"]);
    });

    it("should return cached operations when no auth session", async function () {
      getCCloudAuthSessionStub.resolves(null);

      const testTopic = createKafkaTopic({
        connectionId: CCLOUD_CONNECTION_ID,
        connectionType: ConnectionType.Ccloud,
        environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
        name: "test-ccloud-topic",
        operations: ["READ", "WRITE"],
      });

      const operations = await fetchTopicAuthorizedOperations(testTopic);
      assert.deepStrictEqual(operations, ["READ", "WRITE"]);
    });

    it("should return cached operations when cluster not found", async function () {
      getCCloudAuthSessionStub.resolves({ accessToken: "test-token" });
      getResourceManagerStub.returns({
        getKafkaClustersForEnvironmentId: sandbox.stub().resolves([]),
      });

      const testTopic = createKafkaTopic({
        connectionId: CCLOUD_CONNECTION_ID,
        connectionType: ConnectionType.Ccloud,
        environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
        name: "test-ccloud-topic",
        operations: ["READ"],
      });

      const operations = await fetchTopicAuthorizedOperations(testTopic);
      assert.deepStrictEqual(operations, ["READ"]);
    });

    it("should return cached operations on 401/403 errors", async function () {
      getCCloudAuthSessionStub.resolves({ accessToken: "test-token" });

      const mockCluster = {
        id: TEST_CCLOUD_KAFKA_CLUSTER.id,
        bootstrapServers: "pkc-test.us-west-2.aws.confluent.cloud:9092",
      };
      getResourceManagerStub.returns({
        getKafkaClustersForEnvironmentId: sandbox.stub().resolves([mockCluster]),
      });

      kafkaRestProxyStub.getTopic.rejects(new HttpError("Forbidden", 403, "Forbidden"));

      const testTopic = createKafkaTopic({
        connectionId: CCLOUD_CONNECTION_ID,
        connectionType: ConnectionType.Ccloud,
        environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
        name: "test-ccloud-topic",
        operations: ["READ", "WRITE"],
      });

      const operations = await fetchTopicAuthorizedOperations(testTopic);
      assert.deepStrictEqual(operations, ["READ", "WRITE"]);
    });

    it("should return empty array on 404 error", async function () {
      getCCloudAuthSessionStub.resolves({ accessToken: "test-token" });

      const mockCluster = {
        id: TEST_CCLOUD_KAFKA_CLUSTER.id,
        bootstrapServers: "pkc-test.us-west-2.aws.confluent.cloud:9092",
      };
      getResourceManagerStub.returns({
        getKafkaClustersForEnvironmentId: sandbox.stub().resolves([mockCluster]),
      });

      kafkaRestProxyStub.getTopic.rejects(new HttpError("Not Found", 404, "Not Found"));

      const testTopic = createKafkaTopic({
        connectionId: CCLOUD_CONNECTION_ID,
        connectionType: ConnectionType.Ccloud,
        environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
        name: "test-ccloud-topic",
        operations: ["READ", "WRITE"],
      });

      const operations = await fetchTopicAuthorizedOperations(testTopic);
      assert.deepStrictEqual(operations, []);
    });
  });
});
