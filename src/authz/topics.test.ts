import * as assert from "assert";
import sinon from "sinon";
import { TEST_CCLOUD_KAFKA_TOPIC, TEST_LOCAL_KAFKA_TOPIC } from "../../tests/unit/testResources";
import { TopicData, TopicV3Api } from "../clients/kafkaRest";
import * as sidecar from "../sidecar";
import { KAFKA_TOPIC_OPERATIONS } from "./constants";
import { fetchTopicAuthorizedOperations } from "./topics";
import { KafkaTopicOperation } from "./types";

// TODO: make this a more generic function (or `TEST_TOPIC_DATA` constant) that can be used in other
// tests if we need to start using it more
function createTestTopicData(
  clusterId: string,
  topicName: string,
  authorizedOperations: KafkaTopicOperation[],
): TopicData {
  return {
    kind: "KafkaTopic",
    metadata: {
      self: "test",
    },
    cluster_id: clusterId,
    topic_name: topicName,
    is_internal: false,
    replication_factor: 1,
    partitions_count: 3,
    partitions: {
      related: "test",
    },
    partition_reassignments: {
      related: "test",
    },
    configs: {
      related: "test",
    },
    authorized_operations: authorizedOperations,
  };
}

describe("authz.topics", function () {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<TopicV3Api>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    mockClient = sandbox.createStubInstance(TopicV3Api);
    mockSidecarHandle.getTopicV3Api.returns(mockClient);
    // stub the getSidecar function to return the mock sidecar handle
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("fetchTopicAuthorizedOperations() should return authorized operations for a local topic", async function () {
    // local kafka rest api responds to the 'include_authorized_operations' query param just fine, returns
    // all operations. This and next test basically just test that the mock route is called and demonstrate
    // what we expect to return.
    const topicResp: TopicData = createTestTopicData(
      TEST_LOCAL_KAFKA_TOPIC.clusterId,
      TEST_LOCAL_KAFKA_TOPIC.name,
      [...KAFKA_TOPIC_OPERATIONS], // needs to not be typed 'readonly'
    );

    mockClient.getKafkaTopic.resolves(topicResp);

    const operations = await fetchTopicAuthorizedOperations(TEST_LOCAL_KAFKA_TOPIC);
    assert.deepEqual(operations, KAFKA_TOPIC_OPERATIONS);
  });

  it("fetchTopicAuthorizedOperations() should return authorized operations for a CCloud topic", async function () {
    const topicResp: TopicData = createTestTopicData(
      TEST_CCLOUD_KAFKA_TOPIC.clusterId,
      TEST_CCLOUD_KAFKA_TOPIC.name,
      ["READ", "WRITE"],
    );
    mockClient.getKafkaTopic.resolves(topicResp);

    const operations = await fetchTopicAuthorizedOperations(TEST_CCLOUD_KAFKA_TOPIC);

    assert.deepStrictEqual(operations, ["READ", "WRITE"]);
  });

  /*
  it("validateKafkaTopicOperations() should return empty array if operations array is empty", function () {
    const operations = validateKafkaTopicOperations([]);
    assert.deepStrictEqual(operations, []);
  });

  it("validateKafkaTopicOperations() should return valid operations", function () {
    const operations = validateKafkaTopicOperations(["READ", "WRITE"]);
    assert.deepStrictEqual(operations, ["READ", "WRITE"]);
  });

  it("validateKafkaTopicOperations() should return only valid operations if invalid operations are passed", function () {
    const operations = validateKafkaTopicOperations(["READ", "INVALID_OP"]);
    assert.deepStrictEqual(operations, ["READ"]);
  });
*/
});
