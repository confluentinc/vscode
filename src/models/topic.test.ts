import * as assert from "assert";
import "mocha";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources/topic";

describe("Test KafkaTopic methods", () => {
  it("Local topics should smell local", () => {
    assert.strictEqual(true, TEST_LOCAL_KAFKA_TOPIC.isLocalTopic());
  });

  it("CCLoud topics should not smell local", () => {
    assert.strictEqual(false, TEST_CCLOUD_KAFKA_TOPIC.isLocalTopic());
  });

  it("ccloudUrl should return the correct URL for ccloud-resident topics", () => {
    assert.strictEqual(
      `https://confluent.cloud/environments/${TEST_CCLOUD_KAFKA_TOPIC.environmentId}/clusters/${TEST_CCLOUD_KAFKA_TOPIC.clusterId}/topics/${TEST_CCLOUD_KAFKA_TOPIC.name}/overview`,
      TEST_CCLOUD_KAFKA_TOPIC.ccloudUrl,
    );
  });

  it("ccloudUrl should return an empty string for local topics", () => {
    assert.strictEqual("", TEST_LOCAL_KAFKA_TOPIC.ccloudUrl);
  });
});
