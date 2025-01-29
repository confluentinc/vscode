import assert from "assert";
import { TEST_LOCAL_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { createTestTopicData } from "../../tests/unit/testUtils";
import { TopicData } from "../clients/kafkaRest/models";
import * as loaderUtils from "./loaderUtils";

// as from fetchTopics() result.
export const topicsResponseData: TopicData[] = [
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic4", ["READ", "WRITE"]),
];

describe("correlateTopicsWithSchemaSubjects() test", () => {
  it("should correlate topics with schema subjects as strings", () => {
    // topic 1-3 will be correlated with schema subjects, topic 4 will not.
    const subjects: string[] = ["topic1-value", "topic2-key", "topic3-Foo"];

    const results = loaderUtils.correlateTopicsWithSchemaSubjects(
      TEST_LOCAL_KAFKA_CLUSTER,
      topicsResponseData,
      subjects,
    );

    assert.ok(results[0].hasSchema);
    assert.ok(results[1].hasSchema);
    assert.ok(results[2].hasSchema);
    assert.ok(!results[3].hasSchema);
  });
});
