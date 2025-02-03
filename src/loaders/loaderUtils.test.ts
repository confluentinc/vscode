import assert from "assert";
import * as sinon from "sinon";
import {
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { createTestTopicData, getTestStorageManager } from "../../tests/unit/testUtils";
import { TopicData } from "../clients/kafkaRest/models";
import {
  GetSchemaByVersionRequest,
  Schema as ResponseSchema,
  SubjectsV1Api,
} from "../clients/schemaRegistryRest";
import * as loaderUtils from "../loaders/loaderUtils";
import { SchemaRegistry } from "../models/schemaRegistry";
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

describe("loaderUtils fetchSchemaSubjectGroup() tests", () => {
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

describe("loaderUtils fetchSubjects() tests", () => {
  let sandbox: sinon.SinonSandbox;
  let subjectsV1ApiStub: sinon.SinonStubbedInstance<SubjectsV1Api>;

  beforeEach(async () => {
    await getTestStorageManager();

    sandbox = sinon.createSandbox();

    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);

    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

    subjectsV1ApiStub = sandbox.createStubInstance(SubjectsV1Api);

    mockSidecarHandle.getSubjectsV1Api.returns(subjectsV1ApiStub);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fetch versions of schemas for a given subject", async () => {
    const schemaRegistry: SchemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
    const subject: string = "topic1-value";

    const versions = [1, 2, 3];
    subjectsV1ApiStub.listVersions.resolves(versions);

    async function mockGetSchemaByVersion(
      request: GetSchemaByVersionRequest,
    ): Promise<ResponseSchema> {
      return {
        id: Number.parseInt(request.version) + 10000,
        subject: request.subject,
        version: parseInt(request.version),
        schema: "insert schema document here",
        schemaType: "AVRO",
      };
    }
    subjectsV1ApiStub.getSchemaByVersion.callsFake(mockGetSchemaByVersion);

    await loaderUtils.fetchSchemaSubjectGroup(schemaRegistry, subject);
  });
});
