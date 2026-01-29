import assert from "assert";
import * as sinon from "sinon";
import {
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_ORGANIZATION_ID } from "../../../tests/unit/testResources/organization";
import { createTestTopicData } from "../../../tests/unit/testUtils";
import type { TopicData } from "../../clients/kafkaRest/models";
import type { IFlinkStatementSubmitParameters } from "../../flinkSql/statementUtils";
import type { Schema } from "../../models/schema";
import { SchemaType, Subject } from "../../models/schema";
import * as schemaRegistryProxy from "../../proxy/schemaRegistryProxy";
import * as kafkaRestProxy from "../../proxy/kafkaRestProxy";
import { HttpError } from "../../proxy/httpClient";
import * as privateNetworking from "../../utils/privateNetworking";
import * as loaderUtils from "./loaderUtils";

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
    let mockProxy: {
      listSubjects: sinon.SinonStub;
      listVersions: sinon.SinonStub;
      getSchemaByVersion: sinon.SinonStub;
    };

    beforeEach(() => {
      mockProxy = {
        listSubjects: sandbox.stub(),
        listVersions: sandbox.stub(),
        getSchemaByVersion: sandbox.stub(),
      };
      sandbox
        .stub(schemaRegistryProxy, "createSchemaRegistryProxy")
        .returns(
          mockProxy as unknown as ReturnType<typeof schemaRegistryProxy.createSchemaRegistryProxy>,
        );
    });

    it("fetchSubjects() should return subjects sorted", async () => {
      const subjectsRaw = ["Subject2", "subject3", "subject1"];
      mockProxy.listSubjects.resolves(subjectsRaw);

      const subjects = await loaderUtils.fetchSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
      const subjectStrings = subjects.map((s) => s.name);

      // be sure to test against a wholly separate array, 'cause .sort() is in-place.
      // Will do a locale search which is case independent
      assert.deepStrictEqual(subjectStrings, ["subject1", "Subject2", "subject3"]);
    });

    it("fetchSubjects() should work with empty string subjects", async () => {
      mockProxy.listSubjects.resolves(["subject1", "", "subject2"]);
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
      mockProxy.listVersions.resolves(versions);

      // Then will ultimately drive the getSchemaByVersion() API call for each version.
      mockProxy.getSchemaByVersion.callsFake(async (subj: string, version: number) => {
        return {
          id: version + 10000,
          subject: subj,
          version: version,
          schema: "insert schema document here",
          schemaType: "AVRO",
        };
      });

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

      // And each schema should have the right properties as from the mock.
      for (const schema of schemas) {
        assert.equal(schema.subject, subject);
        assert.equal(schema.type, SchemaType.Avro);
        assert.equal(schema.id, `${schema.version + 10000}`);
      }
    });

    it("fetchSchemasForSubject() throws if any single version fetch fails", async () => {
      const subject: string = "topic1-value";

      // When fetchSchemasForSubject() starts out and determines the versions of the subject, will
      // learn that there are 3 versions. And as if version 1 was soft deleted.
      const versions = [2, 3, 4];
      mockProxy.listVersions.resolves(versions);

      // Then will ultimately drive the getSchemaByVersion() API call for each version.
      mockProxy.getSchemaByVersion.callsFake(async (subj: string, version: number) => {
        if (version === 3) {
          throw new Error("Failed to fetch schema");
        }
        return {
          id: version + 10000,
          subject: subj,
          version: version,
          schema: "insert schema document here",
          schemaType: "AVRO",
        };
      });

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
    let mockKafkaProxy: {
      listTopics: sinon.SinonStub;
    };

    beforeEach(() => {
      mockKafkaProxy = {
        listTopics: sandbox.stub(),
      };
      sandbox
        .stub(kafkaRestProxy, "createKafkaRestProxy")
        .returns(
          mockKafkaProxy as unknown as ReturnType<typeof kafkaRestProxy.createKafkaRestProxy>,
        );
    });

    it("fetchTopics should return sorted topics", async () => {
      // Not sorted route result.
      const unsortedTopicsData: TopicData[] = [
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"]),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic4", ["READ", "WRITE"]),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"]),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"]),
      ];

      mockKafkaProxy.listTopics.resolves(unsortedTopicsData);

      const topics = await loaderUtils.fetchTopics(TEST_LOCAL_KAFKA_CLUSTER);

      // Check that the topics are sorted by name.
      const topicNames = topics.map((t) => t.topic_name);
      assert.deepStrictEqual(topicNames, ["topic1", "topic2", "topic3", "topic4"]);
    });

    it("fetchTopics should exclude virtual topics with 0 replication factor", async () => {
      const topicsWithVirtual: TopicData[] = [
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic1", ["READ", "WRITE"], 1),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic2", ["READ", "WRITE"], 0), // virtual topic
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic3", ["READ", "WRITE"], 3),
        createTestTopicData(TEST_LOCAL_KAFKA_CLUSTER.id, "topic4", ["READ", "WRITE"], 0), // virtual topic
      ];

      mockKafkaProxy.listTopics.resolves(topicsWithVirtual);

      const topics = await loaderUtils.fetchTopics(TEST_LOCAL_KAFKA_CLUSTER);

      // Check that the topics with replication_factor 0 are excluded.
      const topicNames = topics.map((t) => t.topic_name);
      assert.deepStrictEqual(topicNames, ["topic1", "topic3"]);
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

        const httpError = new HttpError("error message", 500, "Internal Server Error");
        mockKafkaProxy.listTopics.rejects(httpError);
      });

      it("fetchTopics should show private networking help notification when notices private networking symptom", async () => {
        containsPrivateNetworkPatternStub.returns(true);

        const results = await loaderUtils.fetchTopics(TEST_CCLOUD_KAFKA_CLUSTER);
        assert.deepStrictEqual(results, []);

        sinon.assert.calledOnce(showPrivateNetworkingHelpNotificationStub);
      });

      it("fetchTopics should throw TopicFetchError when not private networking symptom HttpError", async () => {
        containsPrivateNetworkPatternStub.returns(false);

        await assert.rejects(
          loaderUtils.fetchTopics(TEST_CCLOUD_KAFKA_CLUSTER),
          loaderUtils.TopicFetchError,
        );

        sinon.assert.notCalled(showPrivateNetworkingHelpNotificationStub);
      });

      it("fetchTopics should throw TopicFetchError when not an HttpError", async () => {
        mockKafkaProxy.listTopics.rejects(new Error("Some other error"));

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
