import assert from "assert";
import * as sinon from "sinon";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import {
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_ORGANIZATION_ID } from "../../tests/unit/testResources/organization";
import { createResponseError, createTestTopicData } from "../../tests/unit/testUtils";
import { TopicV3Api } from "../clients/kafkaRest";
import { TopicData } from "../clients/kafkaRest/models";
import {
  GetSchemaByVersionRequest,
  Schema as ResponseSchema,
  SubjectsV1Api,
} from "../clients/schemaRegistryRest";
import { IFlinkStatementSubmitParameters } from "../flinkSql/statementUtils";
import * as loaderUtils from "../loaders/loaderUtils";
import { Schema, SchemaType, Subject } from "../models/schema";
import * as sidecar from "../sidecar";
import { SidecarHandle } from "../sidecar";
import * as privateNetworking from "../utils/privateNetworking";

// as from fetchTopics() result.
export const topicsResponseData: TopicData[] = [
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"]),
  createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic4", ["READ", "WRITE"]),
];

describe("loaderUtils.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("correlateTopicsWithSchemaSubjects()", () => {
    it("should correlate topics with schema subjects as strings", () => {
      // topic 1-3 will be correlated with schema subjects, topic 4 will not.
      // (Include empty string subject to further exercise issue #2149.)
      const subjectStrings: string[] = ["topic1-value", "topic2-key", "topic3-Foo", ""];
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

      // None should be flinkable, as this is not a CCloud cluster.
      results.forEach((t) => assert.ok(!t.isFlinkable));
    });

    it("should assign isFlinkable based on whether or not the cluster is a Flinkable CCloud cluster", () => {
      // no subjects, just looking to see if isFlinkable is set correctly.
      const subjects: Subject[] = [];

      const ccloudFlinkableResults = loaderUtils.correlateTopicsWithSchemaSubjects(
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        topicsResponseData,
        subjects,
      );
      ccloudFlinkableResults.forEach((t) =>
        assert.ok(t.isFlinkable, "CCloud Flinkable cluster should have flinkable topics"),
      );

      assert.ok(
        TEST_CCLOUD_KAFKA_CLUSTER.isFlinkable() === false,
        "Expected TEST_CCLOUD_KAFKA_CLUSTER to not be Flinkable",
      );
      const ccloudNonFlinkableResults = loaderUtils.correlateTopicsWithSchemaSubjects(
        TEST_CCLOUD_KAFKA_CLUSTER, // Not Flinkable
        topicsResponseData,
        subjects,
      );
      ccloudNonFlinkableResults.forEach((t) =>
        assert.ok(!t.isFlinkable, "CCloud non-Flinkable cluster should not have flinkable topics"),
      );

      const localResults = loaderUtils.correlateTopicsWithSchemaSubjects(
        TEST_LOCAL_KAFKA_CLUSTER,
        topicsResponseData,
        subjects,
      );
      localResults.forEach((t) =>
        assert.ok(!t.isFlinkable, "Local cluster should not have flinkable topics"),
      );
    });
  });

  describe("fetchSubjects() and fetchSchemasForSubject() tests", () => {
    // Common suite and setup for loaderUtils functions that interact with SubjectsV1Api.
    let stubbedSubjectsV1Api: sinon.SinonStubbedInstance<SubjectsV1Api>;

    beforeEach(() => {
      const stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle> = getSidecarStub(sandbox);
      stubbedSubjectsV1Api = sandbox.createStubInstance(SubjectsV1Api);
      stubbedSidecar.getSubjectsV1Api.returns(stubbedSubjectsV1Api);
    });

    it("fetchSubjects() should return subjects sorted", async () => {
      const subjectsRaw = ["Subject2", "subject3", "subject1"];
      stubbedSubjectsV1Api.list.resolves(subjectsRaw);

      const subjects = await loaderUtils.fetchSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
      const subjectStrings = subjects.map((s) => s.name);

      // be sure to test against a wholly separate array, 'cause .sort() is in-place.
      // Will do a locale search which is case independent
      assert.deepStrictEqual(subjectStrings, ["subject1", "Subject2", "subject3"]);
    });

    it("fetchSubjects() should work with empty string subjects", async () => {
      stubbedSubjectsV1Api.list.resolves(["subject1", "", "subject2"]);
      const subjects = await loaderUtils.fetchSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
      const subjectStrings = subjects.map((s) => s.name);
      // Should include the empty string subject.
      assert.deepStrictEqual(subjectStrings, ["", "subject1", "subject2"]);
    });

    it("fetchSchemasForSubject() should fetch versions of schemas for a given subject", async () => {
      const subject: string = "topic1-value";

      // When fetchSchemasForSubject() starts out and determines the versions of the subject, will
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
      const schemas: Schema[] = await loaderUtils.fetchSchemasForSubject(
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

    it("fetchSchemasForSubject() throws if any single version fetch fails", async () => {
      const subject: string = "topic1-value";

      // When fetchSchemasForSubject() starts out and determines the versions of the subject, will
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
        loaderUtils.fetchSchemasForSubject(TEST_LOCAL_SCHEMA_REGISTRY, subject),
        new Error("Failed to fetch schema"),
      );
    });
  });

  describe("fetchTopics()", () => {
    let mockSidecar: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;
    let mockClient: sinon.SinonStubbedInstance<TopicV3Api>;

    beforeEach(() => {
      mockSidecar = getSidecarStub(sandbox);
      mockClient = sandbox.createStubInstance(TopicV3Api);
      mockSidecar.getTopicV3Api.returns(mockClient);
    });

    it("fetchTopics should return sorted topics", async () => {
      // Not sorted route result.
      const topicsResponseData: TopicData[] = [
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"]),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic4", ["READ", "WRITE"]),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"]),
      ];

      mockClient.listKafkaTopics.resolves({
        kind: "kind",
        metadata: {} as any,
        data: topicsResponseData,
      });

      const topics = await loaderUtils.fetchTopics(TEST_LOCAL_KAFKA_CLUSTER);

      // Check that the topics are sorted by name.
      const topicNames = topics.map((t) => t.topic_name);
      assert.deepStrictEqual(topicNames, ["topic1", "topic2", "topic3", "topic4"]);
    });

    describe("fetchTopics error handling", () => {
      let containsPrivateNetworkPatternStub: sinon.SinonStub;
      let showPrivateNetworkingHelpNotificationStub: sinon.SinonStub;

      beforeEach(() => {
        containsPrivateNetworkPatternStub = sandbox.stub(
          privateNetworking,
          "containsPrivateNetworkPattern",
        );

        showPrivateNetworkingHelpNotificationStub = sandbox.stub(
          privateNetworking,
          "showPrivateNetworkingHelpNotification",
        );

        const errorResponse = createResponseError(500, "error message", "{}");
        mockClient.listKafkaTopics.rejects(errorResponse);
      });

      it("fetchTopics should show private networking help notification when notices private networking symptom", async () => {
        containsPrivateNetworkPatternStub.returns(true);

        const results = await loaderUtils.fetchTopics(TEST_CCLOUD_KAFKA_CLUSTER);
        assert.deepStrictEqual(results, []);

        sinon.assert.calledOnce(showPrivateNetworkingHelpNotificationStub);
      });

      it("fetchTopics should throw TopicFetchError when not private networking symptom ResponseError", async () => {
        containsPrivateNetworkPatternStub.returns(false);

        await assert.rejects(
          loaderUtils.fetchTopics(TEST_CCLOUD_KAFKA_CLUSTER),
          loaderUtils.TopicFetchError,
        );

        sinon.assert.notCalled(showPrivateNetworkingHelpNotificationStub);
      });

      it("fetchTopics should throw TopicFetchError when not a ResponseError", async () => {
        mockClient.listKafkaTopics.rejects(new Error("Some other error"));

        await assert.rejects(
          loaderUtils.fetchTopics(TEST_CCLOUD_KAFKA_CLUSTER),
          loaderUtils.TopicFetchError,
        );

        sinon.assert.notCalled(showPrivateNetworkingHelpNotificationStub);
      });
    });
  });

  describe("generateFlinkStatementKey()", () => {
    const mainStatementParams: IFlinkStatementSubmitParameters = {
      statement: "SHOW USER FUNCTIONS",
      statementName: "name",
      organizationId: TEST_CCLOUD_ORGANIZATION_ID,
      computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      hidden: true, // Hidden statement, user didn't author it.
      properties: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.toFlinkSpecProperties(),
    };

    it("should generate the same key for identical parameters", () => {
      const key1 = loaderUtils.generateFlinkStatementKey(mainStatementParams);
      const key2 = loaderUtils.generateFlinkStatementKey(mainStatementParams);
      assert.strictEqual(key1, key2);
    });

    it("should generate same key independent of statement name", () => {
      const differentNameParams: IFlinkStatementSubmitParameters = {
        ...mainStatementParams,
        statementName: "some-other-name",
      };
      const key1 = loaderUtils.generateFlinkStatementKey(mainStatementParams);
      const key2 = loaderUtils.generateFlinkStatementKey(differentNameParams);
      assert.strictEqual(key1, key2);
    });

    it("should generate different keys when compute pool id differs", () => {
      const differentComputePoolParams: IFlinkStatementSubmitParameters = {
        ...mainStatementParams,
        computePool: {
          ...mainStatementParams.computePool,
          id: "some-other-id",
        } as typeof mainStatementParams.computePool,
      };
      const key1 = loaderUtils.generateFlinkStatementKey(mainStatementParams);
      const key2 = loaderUtils.generateFlinkStatementKey(differentComputePoolParams);
      assert.notStrictEqual(key1, key2);
    });

    it("should generate different keys when current database differs", () => {
      const differentDatabaseParams: IFlinkStatementSubmitParameters = {
        ...mainStatementParams,
        properties: {
          ...mainStatementParams.properties,
          currentDatabase: "some-other-database",
        } as typeof mainStatementParams.properties,
      };
      const key1 = loaderUtils.generateFlinkStatementKey(mainStatementParams);
      const key2 = loaderUtils.generateFlinkStatementKey(differentDatabaseParams);
      assert.notStrictEqual(key1, key2);
    });

    it("should generate different keys when current catalog differs", () => {
      const differentCatalogParams: IFlinkStatementSubmitParameters = {
        ...mainStatementParams,
        properties: {
          ...mainStatementParams.properties,
          currentCatalog: "some-other-catalog",
        } as typeof mainStatementParams.properties,
      };
      const key1 = loaderUtils.generateFlinkStatementKey(mainStatementParams);
      const key2 = loaderUtils.generateFlinkStatementKey(differentCatalogParams);
      assert.notStrictEqual(key1, key2);
    });

    it("should generate different keys when statement text differs", () => {
      const differentStatementTextParams: IFlinkStatementSubmitParameters = {
        ...mainStatementParams,
        statement: "SHOW FUNCTIONS", // Slightly different statement text.
      };
      const key1 = loaderUtils.generateFlinkStatementKey(mainStatementParams);
      const key2 = loaderUtils.generateFlinkStatementKey(differentStatementTextParams);
      assert.notStrictEqual(key1, key2);
    });
  });
});
