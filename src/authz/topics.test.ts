import * as assert from "assert";
import sinon from "sinon";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { TEST_CCLOUD_KAFKA_TOPIC, TEST_LOCAL_KAFKA_TOPIC } from "../../tests/unit/testResources";
import { createTestTopicData } from "../../tests/unit/testUtils";
import { TopicData, TopicV3Api } from "../clients/kafkaRest";
import { SidecarHandle } from "../sidecar";
import { KAFKA_TOPIC_OPERATIONS } from "./constants";
import { fetchTopicAuthorizedOperations } from "./topics";

describe("authz.topics", function () {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<TopicV3Api>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    const stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle> = getSidecarStub(sandbox);
    mockClient = sandbox.createStubInstance(TopicV3Api);
    stubbedSidecar.getTopicV3Api.returns(mockClient);
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
