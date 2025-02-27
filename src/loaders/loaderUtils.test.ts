import assert from "assert";
import * as sinon from "sinon";
import {
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { createTestTopicData } from "../../tests/unit/testUtils";
import { TopicData } from "../clients/kafkaRest/models";
import {
  GetSchemaByVersionRequest,
  Schema as ResponseSchema,
  SubjectsV1Api,
} from "../clients/schemaRegistryRest";
import * as loaderUtils from "../loaders/loaderUtils";
import { Schema, SchemaType, Subject } from "../models/schema";
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
    const subjectStrings: string[] = ["topic1-value", "topic2-key", "topic3-Foo"];
    const subjects: Subject[] = subjectStrings.map(
      (name) =>
        new Subject(
          name,
          TEST_LOCAL_SCHEMA_REGISTRY.connectionId,
          TEST_LOCAL_SCHEMA_REGISTRY.environmentId,
          TEST_LOCAL_SCHEMA_REGISTRY.id,
        ),
    );

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

describe("loaderUtils fetchSubjects() and fetchSchemaSubjectGroup() tests", () => {
  // Common suite and setup for loaderUtils functions that interact with SubjectsV1Api.

  let sandbox: sinon.SinonSandbox;
  let stubbedSubjectsV1Api: sinon.SinonStubbedInstance<SubjectsV1Api>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubbedSubjectsV1Api = sandbox.createStubInstance(SubjectsV1Api);

    const getSidecarStub: sinon.SinonStub = sandbox.stub(sidecar, "getSidecar");

    const mockHandle = {
      getSubjectsV1Api: () => {
        return stubbedSubjectsV1Api;
      },
    };
    getSidecarStub.resolves(mockHandle);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("fetchSubjects() should return subjects sorted", async () => {
    const subjectsRaw = ["subject2", "subject3", "subject1"];
    stubbedSubjectsV1Api.list.resolves(subjectsRaw);

    const subjects = await loaderUtils.fetchSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
    const subjectStrings = subjects.map((s) => s.name);

    // be sure to test against a wholly separate array, 'cause .sort() is in-place.
    assert.deepStrictEqual(subjectStrings, ["subject1", "subject2", "subject3"]);
  });

  it("fetchSchemaSubjectGroup() should fetch versions of schemas for a given subject", async () => {
    const subject: string = "topic1-value";

    // When fetchSchemaSubjectGroup() starts out and determines the versions of the subject, will
    // learn that there are 3 versions. And as if version 1 was soft deleted.
    const versions = [2, 3, 4];
    stubbedSubjectsV1Api.listVersions.resolves(versions);

    // Then will ultimately drive the getSchemaByVersion() API client call for each version.
    async function fakeGetSchemaByVersion(
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
    stubbedSubjectsV1Api.getSchemaByVersion.callsFake(fakeGetSchemaByVersion);

    // Make the function call. Should drive the above stubs using executeInWorkerPool()
    // and demultiplex its results properly.
    const schemas: Schema[] = await loaderUtils.fetchSchemaSubjectGroup(
      TEST_LOCAL_SCHEMA_REGISTRY,
      subject,
    );

    assert.equal(schemas.length, versions.length);

    // Should be in the right order (descending by version)...
    assert.deepEqual(
      schemas.map((schema) => schema.version),
      versions.sort((a, b) => b - a),
    );

    // And each schema should have the right properties as from fakeGetSchemaByVersion().
    for (const schema of schemas) {
      assert.equal(schema.subject, subject);
      assert.equal(schema.type, SchemaType.Avro);
      assert.equal(schema.id, schema.version + 10000);
    }
  });

  it("fetchSchemaSubjectGroup() throws if any single version fetch fails", async () => {
    const subject: string = "topic1-value";

    // When fetchSchemaSubjectGroup() starts out and determines the versions of the subject, will
    // learn that there are 3 versions. And as if version 1 was soft deleted.
    const versions = [2, 3, 4];
    stubbedSubjectsV1Api.listVersions.resolves(versions);

    // Then will ultimately drive the getSchemaByVersion() API client call for each version.
    async function fakeGetSchemaByVersion(
      request: GetSchemaByVersionRequest,
    ): Promise<ResponseSchema> {
      if (request.version === "3") {
        throw new Error("Failed to fetch schema");
      }
      return {
        id: Number.parseInt(request.version) + 10000,
        subject: request.subject,
        version: parseInt(request.version),
        schema: "insert schema document here",
        schemaType: "AVRO",
      };
    }
    stubbedSubjectsV1Api.getSchemaByVersion.callsFake(fakeGetSchemaByVersion);

    // Make the function call. Should drive the above stubs using executeInWorkerPool()
    // and demultiplex its results properly, which in this case means noticing the
    // error and re-throwing it.
    await assert.rejects(
      loaderUtils.fetchSchemaSubjectGroup(TEST_LOCAL_SCHEMA_REGISTRY, subject),
      new Error("Failed to fetch schema"),
    );
  });
});
