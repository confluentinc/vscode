import assert from "assert";
import * as sinon from "sinon";
import { getStubbedLocalResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_KEY_SUBJECT,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_LOCAL_ENVIRONMENT,
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
  getTestExtensionContext,
} from "../../tests/unit/testUtils";
import { TopicData } from "../clients/kafkaRest";
import { SubjectsV1Api } from "../clients/schemaRegistryRest";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import * as errors from "../errors";
import { ConnectionId } from "../models/resource";
import { Schema, Subject } from "../models/schema";
import * as notifications from "../notifications";
import * as sidecar from "../sidecar";
import { getResourceManager, ResourceManager } from "../storage/resourceManager";
import { clearWorkspaceState } from "../storage/utils";
import { CCloudResourceLoader } from "./ccloudResourceLoader";
import { DirectResourceLoader } from "./directResourceLoader";
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
    await getTestExtensionContext();
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

describe("ResourceLoader::checkedGetSubjects()", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;
  let getSubjectsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderInstance = LocalResourceLoader.getInstance();
    getSubjectsStub = sandbox.stub(loaderInstance, "getSubjects");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Returns subjects when no error", async () => {
    const subjects = ["subject1", "subject2"];
    getSubjectsStub.resolves(subjects);

    const result = await loaderInstance.checkedGetSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
    assert.deepStrictEqual(result, subjects);
  });

  it("Returns empty array and opens notification when error", async () => {
    const isResponseErrorStub = sandbox.stub(errors, "isResponseError").returns(true);
    const showWarningNotificationWithButtonsStub = sandbox.stub(
      notifications,
      "showWarningNotificationWithButtons",
    );

    getSubjectsStub.rejects(new Error("Test error"));

    const result = await loaderInstance.checkedGetSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
    assert.deepStrictEqual(result, []);
    assert.ok(isResponseErrorStub.calledOnce);
    assert.ok(showWarningNotificationWithButtonsStub.calledOnce);
    assert.ok(
      showWarningNotificationWithButtonsStub
        .getCall(0)
        .args[0].startsWith("Route error fetching schema registry subjects"),
    );
  });

  it("Non-response error is thrown", async () => {
    const isResponseErrorStub = sandbox.stub(errors, "isResponseError").returns(false);
    getSubjectsStub.rejects(new Error("Test error"));

    await assert.rejects(loaderInstance.checkedGetSubjects(TEST_LOCAL_SCHEMA_REGISTRY), (err) => {
      assert.strictEqual((err as Error).message, "Test error");
      assert.ok(isResponseErrorStub.calledOnce);
      return true;
    });
  });
});

/** Tests over the one/two-arg instance method. */
describe("instance ResourceLoader::getEnvironment", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderInstance = LocalResourceLoader.getInstance();
  });
  afterEach(() => {
    sandbox.restore();
  });
  it("Returns environment for known environmentId", async () => {
    sandbox.stub(loaderInstance, "getEnvironments").resolves([TEST_LOCAL_ENVIRONMENT]);
    const environment = await loaderInstance.getEnvironment(TEST_LOCAL_ENVIRONMENT_ID);
    assert.strictEqual(environment?.id, TEST_LOCAL_ENVIRONMENT_ID);
  });
  it("Returns undefined for unknown environmentId", async () => {
    sandbox.stub(loaderInstance, "getEnvironments").resolves([]);
    const environment = await loaderInstance.getEnvironment(TEST_LOCAL_ENVIRONMENT_ID);
    assert.strictEqual(environment, undefined);
  });
});

/** Tests over the two/three-arg static method. */
describe("static ResourceLoader::getEnvironment", () => {
  let stubbedLoader: sinon.SinonStubbedInstance<LocalResourceLoader>;
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });
  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubbedLoader = getStubbedLocalResourceLoader(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Returns environment for known connectionId / environmentId", async () => {
    stubbedLoader.getEnvironment.resolves(TEST_LOCAL_ENVIRONMENT);
    const environment = await ResourceLoader.getEnvironment(
      LOCAL_CONNECTION_ID,
      TEST_LOCAL_ENVIRONMENT_ID,
    );
    assert.strictEqual(environment?.id, TEST_LOCAL_ENVIRONMENT_ID);
  });

  it("Raises error for unknown connectionId", async () => {
    await assert.rejects(
      ResourceLoader.getEnvironment(
        "unknown-connection-id" as ConnectionId,
        TEST_LOCAL_ENVIRONMENT_ID,
      ),
      (err) => {
        assert.strictEqual(
          (err as Error).message,
          "No loader registered for connectionId unknown-connection-id",
        );
        return true;
      },
    );
  });
});

describe("ResourceLoader::clearCache()", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;
  let rmSetSubjectsStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderInstance = LocalResourceLoader.getInstance();
    rmSetSubjectsStub = sandbox.stub(getResourceManager(), "setSubjects");
  });
  afterEach(() => {
    sandbox.restore();
  });

  it("Called with wrong connection id resource throws error", async () => {
    const schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
    await assert.rejects(loaderInstance.clearCache(schemaRegistry), (err) => {
      assert.ok(
        (err as Error).message.startsWith(
          `Mismatched connectionId ${TEST_LOCAL_ENVIRONMENT_ID} for resource`,
        ),
      );
      return true;
    });
  });

  it("clearCache(schemaRegistry) side effects", async () => {
    const schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
    await loaderInstance.clearCache(schemaRegistry);
    assert.ok(rmSetSubjectsStub.calledOnce);
    // calling with undefined will clear out just this single schema registry's subjects.
    assert.ok(rmSetSubjectsStub.calledWithExactly(schemaRegistry, undefined));
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

  afterEach(async () => {
    // clear cached workspace state
    await clearWorkspaceState();

    sandbox.restore();
  });

  it("Raises error for mismatched connectionId in givent cluster", async () => {
    await assert.rejects(loaderInstance.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER), (err) => {
      return (err as Error).message.startsWith(
        `Mismatched connectionId ${TEST_LOCAL_ENVIRONMENT_ID}`,
      );
    });
  });

  it("Returns cached data if available", async () => {
    const cachedTopics = [TEST_LOCAL_KAFKA_TOPIC];
    // Set up the resource manager to return cached topics.
    const rmGetTopicsStub = sandbox.stub(getResourceManager(), "getTopicsForCluster");
    rmGetTopicsStub.resolves(cachedTopics);

    // Call the method under test.
    const topics = await loaderInstance.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);
    assert.deepStrictEqual(topics, cachedTopics);
    // Should not have called fetchTopics() or getSubjects() since cache hit.
    assert.ok(fetchTopicsStub.notCalled);
    assert.ok(getSubjectsStub.notCalled);
    // Should have called getTopicsForCluster() on the resource manager.
    assert.ok(rmGetTopicsStub.calledOnce);
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

  it("Gracefully handles error from getSubjects()", async () => {
    // Set up stubs to simulate error from getSubjects(), which will
    // be eaten gracefully by getTopicsForCluster() use of
    // checkedGetSubjects().
    sandbox.stub(errors, "isResponseError").returns(true);
    getSubjectsStub.rejects(new Error("Test error"));
    const showWarningNotificationWithButtonsStub = sandbox.stub(
      notifications,
      "showWarningNotificationWithButtons",
    );

    const topicsResponseData: TopicData[] = [
      createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
    ];
    fetchTopicsStub.resolves(topicsResponseData);

    const topics = await loaderInstance.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);

    assert.strictEqual(topics.length, 1);
    // Returned topics def won't have schemas.
    assert.ok(!topics[0].hasSchema);

    assert.ok(showWarningNotificationWithButtonsStub.calledOnce);
  });
});

describe("ResourceLoader::getSchemasForSubject()", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;
  let fetchSchemasForSubjectStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderInstance = LocalResourceLoader.getInstance();

    fetchSchemasForSubjectStub = sandbox.stub(loaderUtils, "fetchSchemasForSubject");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Returns schemas for a subject", async () => {
    fetchSchemasForSubjectStub.resolves(TEST_LOCAL_SUBJECT_WITH_SCHEMAS.schemas);

    const schemas = await loaderInstance.getSchemasForSubject(
      TEST_LOCAL_SCHEMA_REGISTRY,
      TEST_LOCAL_SUBJECT_WITH_SCHEMAS.name,
    );
    assert.deepStrictEqual(schemas, TEST_LOCAL_SUBJECT_WITH_SCHEMAS.schemas);
    assert.ok(fetchSchemasForSubjectStub.calledOnce);
  });
});

describe("ResourceLoader::getTopicSubjectGroups() tests", () => {
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

  it("Hates schema registry from wrong environment", async () => {
    // loader is LocalResourceLoader, so it will not accept a schema registry from a different environment.
    assert.rejects(loaderInstance.getTopicSubjectGroups(TEST_CCLOUD_KAFKA_TOPIC), (err) => {
      return (err as Error).message.startsWith("Mismatched connectionId");
    });
  });

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

describe("ResourceLoader::deleteSchemaVersion()", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;
  let stubbedSubjectsV1Api: sinon.SinonStubbedInstance<SubjectsV1Api>;
  let clearCacheStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderInstance = LocalResourceLoader.getInstance();

    stubbedSubjectsV1Api = sandbox.createStubInstance(SubjectsV1Api);

    const mockHandle = {
      getSubjectsV1Api: () => {
        return stubbedSubjectsV1Api;
      },
    };

    const getSidecarStub: sinon.SinonStub = sandbox.stub(sidecar, "getSidecar");

    getSidecarStub.resolves(mockHandle);
    clearCacheStub = sandbox.stub(loaderInstance, "clearCache");
  });

  afterEach(() => {
    sandbox.restore();
  });

  for (const shouldClearSubjects of [true, false]) {
    it(`soft delete test: shouldClearSubjects=${shouldClearSubjects}`, async () => {
      const schema = TEST_LOCAL_SCHEMA;

      await loaderInstance.deleteSchemaVersion(
        schema,
        false, // soft delete
        shouldClearSubjects,
      );

      assert.ok(stubbedSubjectsV1Api.deleteSchemaVersion.calledOnce);

      const expectedRequest = {
        subject: schema.subject,
        version: `${schema.version}`,
        permanent: false,
      };

      assert.deepEqual(
        stubbedSubjectsV1Api.deleteSchemaVersion.getCall(0).args[0],
        expectedRequest,
      );

      if (shouldClearSubjects) {
        assert.ok(clearCacheStub.calledOnce);
        assert.ok(clearCacheStub.calledWithExactly(schema.subjectObject()));
      } else {
        assert.ok(clearCacheStub.notCalled);
      }
    });
  }

  it("hard delete test, should soft delete first, then hard.", async () => {
    const schema = TEST_LOCAL_SCHEMA;

    // hard delete; not the only schema version for the subject.
    await loaderInstance.deleteSchemaVersion(schema, true, false);

    assert.equal(stubbedSubjectsV1Api.deleteSchemaVersion.callCount, 2);

    const expectedSoftDeleteRequest = {
      subject: schema.subject,
      version: `${schema.version}`,
      permanent: false,
    };

    assert.deepEqual(
      stubbedSubjectsV1Api.deleteSchemaVersion.getCall(0).args[0],
      expectedSoftDeleteRequest,
    );

    const expectedHardDeleteRequest = {
      subject: schema.subject,
      version: `${schema.version}`,
      permanent: true,
    };
    assert.deepEqual(
      stubbedSubjectsV1Api.deleteSchemaVersion.getCall(1).args[0],
      expectedHardDeleteRequest,
    );
  });

  it("Deletion route call calls logError() on deletion attempt failure, rethrows", async () => {
    const schema = TEST_LOCAL_SCHEMA;

    const logErrorStub = sandbox.stub(errors, "logError");

    const thrownError = new Error("Deletion error");
    stubbedSubjectsV1Api.deleteSchemaVersion.rejects(thrownError);

    await assert.rejects(loaderInstance.deleteSchemaVersion(schema, true, false), (err) => {
      assert.strictEqual((err as Error).message, "Deletion error");
      return true;
    });

    const logErrorArgs = logErrorStub.getCall(0).args;
    assert.strictEqual(logErrorArgs[0], thrownError);
    assert.strictEqual(logErrorArgs[1], "Error deleting schema version");
    // would send to Sentry.
    assert.ok(logErrorArgs[2]);
  });
});

describe("ResourceLoader::deleteSchemaSubject()", () => {
  let loaderInstance: ResourceLoader;
  let sandbox: sinon.SinonSandbox;
  let stubbedSubjectsV1Api: sinon.SinonStubbedInstance<SubjectsV1Api>;
  let clearCacheStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderInstance = LocalResourceLoader.getInstance();

    stubbedSubjectsV1Api = sandbox.createStubInstance(SubjectsV1Api);

    const mockHandle = {
      getSubjectsV1Api: () => {
        return stubbedSubjectsV1Api;
      },
    };

    const getSidecarStub: sinon.SinonStub = sandbox.stub(sidecar, "getSidecar");
    getSidecarStub.resolves(mockHandle);

    sandbox
      .stub(loaderInstance, "getSchemaRegistryForEnvironmentId")
      .resolves(TEST_LOCAL_SCHEMA_REGISTRY);

    clearCacheStub = sandbox.stub(loaderInstance, "clearCache");
  });

  afterEach(() => {
    sandbox.restore();
  });

  for (const hardDelete of [true, false]) {
    it(`deleteSubject calls test: hardDelete=${hardDelete}`, async () => {
      const subject = TEST_LOCAL_SUBJECT_WITH_SCHEMAS;

      await loaderInstance.deleteSchemaSubject(subject, hardDelete);

      const expectedRequests = hardDelete
        ? [
            { subject: subject.name, permanent: false },
            { subject: subject.name, permanent: true },
          ]
        : [{ subject: subject.name, permanent: false }];

      assert.strictEqual(stubbedSubjectsV1Api.deleteSubject.callCount, expectedRequests.length);

      for (let i = 0; i < expectedRequests.length; i++) {
        assert.deepEqual(
          stubbedSubjectsV1Api.deleteSubject.getCall(i).args[0],
          expectedRequests[i],
        );
      }

      assert.ok(clearCacheStub.calledOnce);
    });
  }
});

describe("ResourceLoader::getInstance()", () => {
  const directConnectionId = "direct-connection-id" as ConnectionId;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    // Register a DirectResourceLoader instance for the directConnectionId test.
    ResourceLoader.registerInstance(
      directConnectionId,
      new DirectResourceLoader(directConnectionId),
    );
  });

  afterEach(() => {
    // Clean up the registered instance after each test.
    ResourceLoader.deregisterInstance(directConnectionId);
  });

  it("Returns LocalResourceLoader instance for LOCAL_CONNECTION_ID", () => {
    const loader = ResourceLoader.getInstance(LOCAL_CONNECTION_ID);
    assert.ok(loader instanceof LocalResourceLoader);
    assert.strictEqual(loader.connectionId, LOCAL_CONNECTION_ID);
  });

  it("Returns CCloudResourceLoader instance for CCloud connectionId", () => {
    const loader = ResourceLoader.getInstance(CCLOUD_CONNECTION_ID);
    assert.ok(loader instanceof CCloudResourceLoader);
    assert.strictEqual(loader.connectionId, CCLOUD_CONNECTION_ID);
  });

  it("Returns DirectResourceLoader instance for Direct connectionId", () => {
    const loader = ResourceLoader.getInstance(directConnectionId);
    assert.ok(loader instanceof ResourceLoader);
    assert.strictEqual(loader.connectionId, directConnectionId);
  });

  it("Raises error if called with unknown connectionId", () => {
    assert.throws(
      () => ResourceLoader.getInstance("unknown-connection-id" as ConnectionId),
      (err) => {
        return (err as Error).message.startsWith("Unknown connectionId");
      },
    );
  });
});

describe("ResourceLoader::dispose()", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  for (const loader of [CCloudResourceLoader, DirectResourceLoader, LocalResourceLoader]) {
    it(`should dispose of all ${loader.name}.disposables`, () => {
      const disposable1 = { dispose: sandbox.stub() };
      const disposable2 = { dispose: sandbox.stub() };

      loader.getDisposables().push(disposable1, disposable2);
      loader.dispose();

      sinon.assert.calledOnce(disposable1.dispose);
      sinon.assert.calledOnce(disposable2.dispose);
      assert.strictEqual(loader.getDisposables().length, 0);
    });
  }
});
