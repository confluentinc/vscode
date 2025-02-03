import assert from "assert";
import * as sinon from "sinon";
import {
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { createTestTopicData } from "../../tests/unit/testUtils";
import { TopicData } from "../clients/kafkaRest/models";
import * as loaderUtils from "../loaders/loaderUtils";
import * as sidecar from "../sidecar";

// as from fetchTopics() result.
export const topicsResponseData: TopicData[] = [
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic4", ["READ", "WRITE"]),
];

describe("loaderUtils correlateTopicsWithSchemaSubjects() test", () => {
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

describe("loaderUtils fetchSubjects() tests", () => {
  let sandbox: sinon.SinonSandbox;

  let listSubjectsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    listSubjectsStub = sandbox.stub();

    const mockSubjectsV1Api = {
      list: listSubjectsStub,
    };

    let getSidecarStub: sinon.SinonStub;
    getSidecarStub = sandbox.stub(sidecar, "getSidecar");

    const mockHandle = {
      getSubjectsV1Api: () => {
        return mockSubjectsV1Api;
      },
    };
    getSidecarStub.resolves(mockHandle);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return subjects sorted", async () => {
    const subjectsRaw = ["subject2", "subject3", "subject1"];
    listSubjectsStub.resolves(subjectsRaw);

    const subjects = await loaderUtils.fetchSubjects(TEST_LOCAL_SCHEMA_REGISTRY);

    // be sure to test against a wholly separate array, 'cause .sort() is in-place.
    assert.deepStrictEqual(subjects, ["subject1", "subject2", "subject3"]);
  });
});
