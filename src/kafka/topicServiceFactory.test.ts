import * as assert from "assert";
import * as sinon from "sinon";
import { CCloudKafkaCluster, DirectKafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import * as environment from "./environment";
import { KafkaAdminTopicService } from "./kafkaAdminTopicService";
import { RestApiTopicService } from "./restApiTopicService";
import type { TopicInfo } from "./topicService";
import {
  getTopicService,
  topicDataToTopicInfo,
  topicInfoToTopicData,
  type SimpleTopicData,
} from "./topicServiceFactory";

describe("kafka/topicServiceFactory", function () {
  let isDesktopStub: sinon.SinonStub;

  beforeEach(function () {
    // Reset singletons
    KafkaAdminTopicService.resetInstance();
    RestApiTopicService.resetInstances();
    // Stub environment detection
    isDesktopStub = sinon.stub(environment, "isDesktopEnvironment");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("getTopicService", function () {
    it("should return RestApiTopicService v3 for CCloud clusters", function () {
      const cluster = CCloudKafkaCluster.create({
        name: "test-cluster",
        id: "lkc-123",
        bootstrapServers: "pkc-123.us-east-1.aws.confluent.cloud:9092",
        environmentId: "env-123" as any,
        provider: "aws",
        region: "us-east-1",
      });

      const service = getTopicService(cluster);

      assert.ok(service instanceof RestApiTopicService);
    });

    it("should return RestApiTopicService v3-local for LOCAL clusters on desktop", function () {
      // LOCAL clusters always use REST API v3-local to get authorized_operations
      isDesktopStub.returns(true);

      const cluster = LocalKafkaCluster.create({
        name: "local-kafka",
        id: "local-cluster-id",
        bootstrapServers: "localhost:9092",
        uri: "http://localhost:8082",
      });

      const service = getTopicService(cluster);

      assert.ok(service instanceof RestApiTopicService);
    });

    it("should return RestApiTopicService v3-local for LOCAL clusters on web", function () {
      // LOCAL clusters always use REST API v3-local to get authorized_operations
      isDesktopStub.returns(false);

      const cluster = LocalKafkaCluster.create({
        name: "local-kafka",
        id: "local-cluster-id",
        bootstrapServers: "localhost:9092",
        uri: "http://localhost:8082",
      });

      const service = getTopicService(cluster);

      assert.ok(service instanceof RestApiTopicService);
    });

    it("should return KafkaAdminTopicService for DIRECT clusters on desktop", function () {
      // DIRECT clusters on desktop use kafkajs Admin with ACL-based authorized_operations
      isDesktopStub.returns(true);

      const cluster = DirectKafkaCluster.create({
        connectionId: "direct-conn-1" as any,
        name: "direct-kafka",
        id: "direct-cluster-id",
        bootstrapServers: "kafka.example.com:9092",
      });

      const service = getTopicService(cluster);

      assert.ok(service instanceof KafkaAdminTopicService);
    });

    it("should return RestApiTopicService v3 for DIRECT clusters on web", function () {
      // Web environment uses REST API for all clusters (no native Kafka client)
      isDesktopStub.returns(false);

      const cluster = DirectKafkaCluster.create({
        connectionId: "direct-conn-1" as any,
        name: "direct-kafka",
        id: "direct-cluster-id",
        bootstrapServers: "kafka.example.com:9092",
      });

      const service = getTopicService(cluster);

      assert.ok(service instanceof RestApiTopicService);
    });
  });

  describe("topicInfoToTopicData", function () {
    it("should convert TopicInfo to TopicData format", function () {
      const topicInfo: TopicInfo = {
        name: "test-topic",
        isInternal: false,
        replicationFactor: 3,
        partitionCount: 6,
        partitions: [
          { partitionId: 0, leader: 1, replicas: [1, 2, 3], isr: [1, 2, 3] },
          { partitionId: 1, leader: 2, replicas: [2, 3, 1], isr: [2, 3, 1] },
        ],
        configs: { "retention.ms": "604800000" },
        authorizedOperations: ["READ", "WRITE"],
      };

      const topicData = topicInfoToTopicData(topicInfo);

      assert.strictEqual(topicData.topic_name, "test-topic");
      assert.strictEqual(topicData.is_internal, false);
      assert.strictEqual(topicData.replication_factor, 3);
      assert.strictEqual(topicData.partitions_count, 6);
      assert.deepStrictEqual(topicData.authorized_operations, ["READ", "WRITE"]);
    });

    it("should handle empty partitions", function () {
      const topicInfo: TopicInfo = {
        name: "test-topic",
        isInternal: false,
        replicationFactor: 3,
        partitionCount: 0,
        partitions: [],
        configs: {},
      };

      const topicData = topicInfoToTopicData(topicInfo);

      assert.strictEqual(topicData.partitions, undefined);
    });

    it("should handle empty configs", function () {
      const topicInfo: TopicInfo = {
        name: "test-topic",
        isInternal: false,
        replicationFactor: 3,
        partitionCount: 0,
        partitions: [],
        configs: {},
      };

      const topicData = topicInfoToTopicData(topicInfo);

      assert.strictEqual(topicData.configs, undefined);
    });
  });

  describe("topicDataToTopicInfo", function () {
    it("should convert SimpleTopicData to TopicInfo format", function () {
      const topicData: SimpleTopicData = {
        topic_name: "test-topic",
        is_internal: false,
        replication_factor: 3,
        partitions_count: 2,
        partitions: {
          data: [
            {
              partition_id: 0,
              leader: { broker_id: 1 },
              replicas: { data: [{ broker_id: 1 }, { broker_id: 2 }] },
              isr: { data: [{ broker_id: 1 }, { broker_id: 2 }] },
            },
          ],
        },
        configs: {
          data: [{ name: "retention.ms", value: "604800000" }],
        },
        authorized_operations: ["READ", "WRITE"],
      };

      const topicInfo = topicDataToTopicInfo(topicData);

      assert.strictEqual(topicInfo.name, "test-topic");
      assert.strictEqual(topicInfo.isInternal, false);
      assert.strictEqual(topicInfo.replicationFactor, 3);
      assert.strictEqual(topicInfo.partitionCount, 2);
      assert.deepStrictEqual(topicInfo.authorizedOperations, ["READ", "WRITE"]);
      assert.deepStrictEqual(topicInfo.configs, { "retention.ms": "604800000" });
    });

    it("should handle missing optional fields", function () {
      const topicData: SimpleTopicData = {
        topic_name: "minimal-topic",
      };

      const topicInfo = topicDataToTopicInfo(topicData);

      assert.strictEqual(topicInfo.name, "minimal-topic");
      assert.strictEqual(topicInfo.isInternal, false);
      assert.strictEqual(topicInfo.replicationFactor, 0);
      assert.strictEqual(topicInfo.partitionCount, 0);
      assert.deepStrictEqual(topicInfo.partitions, []);
      assert.deepStrictEqual(topicInfo.configs, {});
    });
  });
});
