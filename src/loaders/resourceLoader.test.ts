import assert from "assert";
import * as sinon from "sinon";
import {
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { createTestTopicData } from "../../tests/unit/testUtils";
import { TopicData } from "../clients/kafkaRest";
import { EnvironmentId } from "../models/resource";
import * as loaderUtils from "./loaderUtils";
import { LocalResourceLoader } from "./localResourceLoader";
import { ResourceLoader } from "./resourceLoader";

// Tests over base loader class methods like getSubjects(), getTopicsForCluster(),  etc are done
// against LocalKafkaClusterLoader class. This is because the base class ResourceLoader is abstract.
// The LocalKafkaClusterLoader is concrete and doesn't override these base class methods.

describe("ResourceLoader::getSubjects()", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;
  let getSchemaRegistryForEnvironmentIdStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    const fetchSubjectsStub: sinon.SinonStub = sandbox.stub(loaderUtils, "fetchSubjects");
    fetchSubjectsStub.resolves(["subject1", "subject2"]);

    loaderInstance = LocalResourceLoader.getInstance();

    // Set up for if/when called with TEST_LOCAL_SCHEMA_REGISTRY, need to prepare
    // for the call to getSchemaRegistryForEnvironmentId.
    getSchemaRegistryForEnvironmentIdStub = sandbox
      .stub(loaderInstance, "getSchemaRegistryForEnvironmentId")
      .resolves(TEST_LOCAL_SCHEMA_REGISTRY);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Hates not finding schema registry by id", async () => {
    getSchemaRegistryForEnvironmentIdStub.resolves(undefined);

    await assert.rejects(
      loaderInstance.getSubjects("unknown-environment-id" as EnvironmentId),
      /No schema registry found for environment/,
    );
  });

  it("Hates schema registry from wrong environment", async () => {
    // This is a valid schema registry id, but it is not from the local environment.
    await assert.rejects(
      loaderInstance.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY),
      /Mismatched connectionId/,
    );
  });

  it("Returns subjects when called with right schema registry or env id", async () => {
    for (const inputParam of [
      TEST_LOCAL_SCHEMA_REGISTRY,
      TEST_LOCAL_SCHEMA_REGISTRY.environmentId,
    ]) {
      const subjects = await loaderInstance.getSubjects(inputParam);

      assert.deepStrictEqual(subjects, ["subject1", "subject2"]);
    }
  });
});

describe("ResourceLoader::getTopicsForCluster()", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;
  let getSubjectsStub: sinon.SinonStub;
  let fetchTopicsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // set up stubs, loaderInstance
    fetchTopicsStub = sandbox.stub(loaderUtils, "fetchTopics");
    loaderInstance = LocalResourceLoader.getInstance();
    getSubjectsStub = sandbox.stub(loaderInstance, "getSubjects");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Returns correlated topics with schema subjects", async () => {
    const topicsResponseData: TopicData[] = [
      createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
      createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"]),
      createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"]),
    ];

    fetchTopicsStub.resolves(topicsResponseData);
    getSubjectsStub.resolves(["topic1-value", "topic2-key"]);

    const topics = await loaderInstance.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);

    assert.strictEqual(topics.length, 3);
    assert.ok(topics[0].hasSchema);
    assert.ok(topics[1].hasSchema);
    assert.ok(!topics[2].hasSchema);

    assert.ok(getSubjectsStub.calledOnce);
    assert.ok(fetchTopicsStub.calledOnce);
  });
});
