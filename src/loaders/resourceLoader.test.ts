import assert from "assert";
import * as sinon from "sinon";
import {
  TEST_CCLOUD_KEY_SUBJECT,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_LOCAL_ENVIRONMENT_ID,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REGISTRY,
  TEST_LOCAL_SUBJECT_WITH_SCHEMAS,
} from "../../tests/unit/testResources";
import {
  createTestSubject,
  createTestTopicData,
  getTestStorageManager,
} from "../../tests/unit/testUtils";
import { TopicData } from "../clients/kafkaRest";
import { Schema, Subject } from "../models/schema";
import { getResourceManager, ResourceManager } from "../storage/resourceManager";
import * as loaderUtils from "./loaderUtils";
import { LocalResourceLoader } from "./localResourceLoader";
import { ResourceLoader } from "./resourceLoader";

// Tests over base loader class methods like getSubjects(), getTopicsForCluster(),  etc are done
// against LocalKafkaClusterLoader class. This is because the base class ResourceLoader is abstract.
// The LocalKafkaClusterLoader is concrete and doesn't override these base class methods.

describe("ResourceLoader::getSubjects()", () => {
  let resourceManager: ResourceManager;
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;

  let getSchemaRegistryForEnvironmentIdStub: sinon.SinonStub;
  let fetchSubjectsStub: sinon.SinonStub;

  let rmGetSubjectsStub: sinon.SinonStub;
  let rmSetSubjectsStub: sinon.SinonStub;

  before(async () => {
    await getTestStorageManager();
    resourceManager = getResourceManager();
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    fetchSubjectsStub = sandbox.stub(loaderUtils, "fetchSubjects");

    loaderInstance = LocalResourceLoader.getInstance();

    // Set up for if/when called with TEST_LOCAL_SCHEMA_REGISTRY, need to prepare
    // for the call to getSchemaRegistryForEnvironmentId.
    getSchemaRegistryForEnvironmentIdStub = sandbox
      .stub(loaderInstance, "getSchemaRegistryForEnvironmentId")
      .resolves(TEST_LOCAL_SCHEMA_REGISTRY);

    // Stub these out for test to then provide the return values.
    rmGetSubjectsStub = sandbox.stub(resourceManager, "getSubjects");
    rmSetSubjectsStub = sandbox.stub(resourceManager, "setSubjects");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Hates schema registry from wrong environment", async () => {
    // This is a valid schema registry id, but it is not from the local environment.
    await assert.rejects(
      loaderInstance.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY),
      /Mismatched connectionId/,
    );
  });

  // test both nonemtpy and empty array return values from fetchSubjects() stub to ensure both paths
  // get cached and returned properly.
  for (const fetchSubjectsStubReturns of [[TEST_CCLOUD_SUBJECT, TEST_CCLOUD_KEY_SUBJECT], []]) {
    it(`Returns subjects when called with right schema registry or env id: resource manager deep fetch / length ${fetchSubjectsStubReturns.length}`, async () => {
      fetchSubjectsStub.resolves(fetchSubjectsStubReturns);
      rmGetSubjectsStub.resolves(undefined);

      for (const inputParam of [
        TEST_LOCAL_SCHEMA_REGISTRY,
        TEST_LOCAL_SCHEMA_REGISTRY.environmentId,
      ]) {
        const subjects = await loaderInstance.getSubjects(inputParam);

        assert.deepStrictEqual(subjects, fetchSubjectsStubReturns);
        // will have asked for the subjects from the resource manager, but none returned, so deep fetched.
        assert.ok(rmGetSubjectsStub.calledOnce);
        /// will have stored the deep fetched subjects in the resource manager.
        assert.ok(
          rmSetSubjectsStub.calledWithExactly(TEST_LOCAL_SCHEMA_REGISTRY, fetchSubjectsStubReturns),
        );

        // reset the resource manager stubs for next iteration.
        rmGetSubjectsStub.resetHistory();
        rmSetSubjectsStub.resetHistory();
      }
    });
  }

  for (const rmGetSubjectsStubReturns of [[TEST_CCLOUD_SUBJECT, TEST_CCLOUD_KEY_SUBJECT], []]) {
    it(`Returns subjects when called with right schema registry or env id: resource manager cache hit / length ${rmGetSubjectsStubReturns.length}`, async () => {
      rmGetSubjectsStub.resolves(rmGetSubjectsStubReturns);

      for (const inputParam of [
        TEST_LOCAL_SCHEMA_REGISTRY,
        TEST_LOCAL_SCHEMA_REGISTRY.environmentId,
      ]) {
        const subjects = await loaderInstance.getSubjects(inputParam);

        assert.deepStrictEqual(subjects, rmGetSubjectsStubReturns);

        // will have asked for the subjects from the resource manager, and found them.
        assert.ok(rmGetSubjectsStub.calledOnce);
        // Not deep fetched 'cause of resource manager cache hit.
        assert.ok(fetchSubjectsStub.notCalled);
        // will not call setSubjects() because of cache hit.
        assert.ok(rmSetSubjectsStub.notCalled);

        // reset the resource manager stub for next iteration.
        rmGetSubjectsStub.resetHistory();
      }
    });
  }

  it("Performs deep fetch when forceRefresh=true", async () => {
    const fetchSubjectsStubReturns = [TEST_CCLOUD_SUBJECT, TEST_CCLOUD_KEY_SUBJECT];
    fetchSubjectsStub.resolves(fetchSubjectsStubReturns);

    for (const inputParam of [
      TEST_LOCAL_SCHEMA_REGISTRY,
      TEST_LOCAL_SCHEMA_REGISTRY.environmentId,
    ]) {
      const subjects = await loaderInstance.getSubjects(inputParam, true);

      assert.deepStrictEqual(subjects, fetchSubjectsStubReturns);
      // will not have asked resource manager for subjects, since deep fetch is forced.
      assert.ok(rmGetSubjectsStub.notCalled);
      /// will have stored the deep fetched subjects in the resource manager.
      assert.ok(
        rmSetSubjectsStub.calledWithExactly(TEST_LOCAL_SCHEMA_REGISTRY, fetchSubjectsStubReturns),
      );

      // reset the resource manager stubs for next iteration.
      rmGetSubjectsStub.resetHistory();
      rmSetSubjectsStub.resetHistory();
    }
  });

  it("Returns empty array when empty array is ResourceManager cache contents", async () => {
    // Set up the resource manager to return an empty array.
    rmGetSubjectsStub.resolves([]);

    for (const inputParam of [
      TEST_LOCAL_SCHEMA_REGISTRY,
      TEST_LOCAL_SCHEMA_REGISTRY.environmentId,
    ]) {
      const subjects = await loaderInstance.getSubjects(inputParam);

      assert.deepStrictEqual(subjects, []);

      // will have asked for the subjects from the resource manager, and found them.
      assert.ok(rmGetSubjectsStub.calledOnce);
      // Not deep fetched 'cause of resource manager cache hit.
      assert.ok(fetchSubjectsStub.notCalled);
      // will not call setSubjects() because of cache hit.
      assert.ok(rmSetSubjectsStub.notCalled);

      // reset the resource manager stub for next iteration.
      rmGetSubjectsStub.resetHistory();
    }
  });

  it("Returns empty array when resolveSchemaRegistry() cannot find a schema registry", async () => {
    // Set up for no schema registry within the environment,
    // so that resolveSchemaRegistry() will throw "No schema registry found for environment".
    getSchemaRegistryForEnvironmentIdStub.resolves(undefined);

    // getSubjects() should eat that error and return empty array.
    const subjects = await loaderInstance.getSubjects(TEST_LOCAL_ENVIRONMENT_ID);

    assert.deepStrictEqual(subjects, []);
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
    getSubjectsStub.resolves([
      createTestSubject(TEST_LOCAL_SCHEMA_REGISTRY, "topic1-value"),
      createTestSubject(TEST_LOCAL_SCHEMA_REGISTRY, "topic2-key"),
    ]);

    const topics = await loaderInstance.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);

    assert.strictEqual(topics.length, 3);
    assert.ok(topics[0].hasSchema);
    assert.ok(topics[1].hasSchema);
    assert.ok(!topics[2].hasSchema);

    assert.ok(getSubjectsStub.calledOnce);
    assert.ok(fetchTopicsStub.calledOnce);
  });

  it("Returns topics without schemas if getSubjects() returns empty array", async () => {
    const topicsResponseData: TopicData[] = [
      createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
      createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"]),
      createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"]),
    ];

    fetchTopicsStub.resolves(topicsResponseData);
    // as when there is no schema registry in the environment.
    getSubjectsStub.resolves([]);

    const topics = await loaderInstance.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);

    assert.strictEqual(topics.length, 3);
    assert.ok(!topics[0].hasSchema);
    assert.ok(!topics[1].hasSchema);
    assert.ok(!topics[2].hasSchema);

    assert.ok(getSubjectsStub.calledOnce);
    assert.ok(fetchTopicsStub.calledOnce);
  });
});

describe("ResourceLoader::getSchemasForSubject() tests", () => {
  let loaderInstance: ResourceLoader;

  let sandbox: sinon.SinonSandbox;
  let getSubjectsStub: sinon.SinonStub;
  let getSchemasForSubjectStub: sinon.SinonStub;

  beforeEach(() => {
    loaderInstance = LocalResourceLoader.getInstance();

    sandbox = sinon.createSandbox();
    getSubjectsStub = sandbox.stub(loaderInstance, "getSubjects");
    getSchemasForSubjectStub = sandbox.stub(loaderInstance, "getSchemasForSubject");
  });

  afterEach(() => {
    sandbox.restore();
  });

  /** Set up return result from getSubjects API call based on the given schemas */
  function populateSubjects(schemas: Schema[]) {
    const seenSubjectStrings: Set<string> = new Set();
    const uniqueSubjects: Subject[] = [];
    for (const schema of schemas) {
      if (!seenSubjectStrings.has(schema.subject)) {
        uniqueSubjects.push(schema.subjectObject());
        seenSubjectStrings.add(schema.subject);
      }
    }

    getSubjectsStub.resolves(Array.from(uniqueSubjects));
  }

  it("Returns related subjects+schemas for a topic", async () => {
    populateSubjects(TEST_LOCAL_SUBJECT_WITH_SCHEMAS.schemas!);
    getSchemasForSubjectStub.resolves(TEST_LOCAL_SUBJECT_WITH_SCHEMAS.schemas);

    // Should return single subject group with schemas.
    const subjects = await loaderInstance.getTopicSubjectGroups(TEST_LOCAL_KAFKA_TOPIC);
    assert.deepStrictEqual(subjects, [TEST_LOCAL_SUBJECT_WITH_SCHEMAS]);
  });

  it("If no related subjects, then empty array is returned", async () => {
    // None of these schema/subjects correspond to TEST_LOCAL_KAFKA_TOPIC.
    const preloadedSchemas: Schema[] = [
      Schema.create({ ...TEST_LOCAL_SCHEMA, subject: "foo-value", version: 1, id: "1" }),
      Schema.create({ ...TEST_LOCAL_SCHEMA, subject: "foo-value", version: 2, id: "2" }),
      Schema.create({ ...TEST_LOCAL_SCHEMA, subject: "other-topic", version: 1, id: "3" }),
    ];

    populateSubjects(preloadedSchemas);

    const schemas = await loaderInstance.getTopicSubjectGroups(TEST_LOCAL_KAFKA_TOPIC);
    assert.deepStrictEqual(schemas, []);
  });
});
