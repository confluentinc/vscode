import * as assert from "assert";
import * as sinon from "sinon";
import { KafkaRestProxy, createKafkaRestProxy } from "./kafkaRestProxy";
import type { KafkaRestProxyConfig } from "./kafkaRestProxy";
import { HttpError } from "./httpClient";

describe("proxy/kafkaRestProxy", function () {
  let fetchStub: sinon.SinonStub;
  let proxy: KafkaRestProxy;

  const defaultConfig: KafkaRestProxyConfig = {
    baseUrl: "https://kafka.example.com",
    clusterId: "cluster-123",
    timeout: 5000,
  };

  function mockResponse<T>(data: T, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response;
  }

  function mockListResponse<T>(data: T[]): Response {
    return mockResponse({
      kind: "KafkaTopicList",
      metadata: { self: "https://kafka.example.com/..." },
      data,
    });
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
    proxy = new KafkaRestProxy(defaultConfig);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("constructor", function () {
    it("should create proxy with config", function () {
      const testProxy = new KafkaRestProxy(defaultConfig);
      assert.strictEqual(testProxy.getClusterId(), "cluster-123");
    });

    it("should accept auth configuration", function () {
      const configWithAuth: KafkaRestProxyConfig = {
        ...defaultConfig,
        auth: { type: "bearer", token: "test-token" },
      };

      const testProxy = new KafkaRestProxy(configWithAuth);
      fetchStub.resolves(mockResponse({ kind: "ClusterData" }));

      void testProxy.getCluster();

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer test-token");
    });

    it("should accept custom headers", function () {
      const configWithHeaders: KafkaRestProxyConfig = {
        ...defaultConfig,
        headers: { "X-Connection-Id": "conn-123" },
      };

      const testProxy = new KafkaRestProxy(configWithHeaders);
      fetchStub.resolves(mockResponse({ kind: "ClusterData" }));

      void testProxy.getCluster();

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["X-Connection-Id"], "conn-123");
    });
  });

  describe("getCluster()", function () {
    it("should get cluster information", async function () {
      const clusterData = {
        kind: "KafkaCluster",
        metadata: { self: "..." },
        cluster_id: "cluster-123",
      };
      fetchStub.resolves(mockResponse(clusterData));

      const result = await proxy.getCluster();

      assert.strictEqual(result.cluster_id, "cluster-123");
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/kafka/v3/clusters/cluster-123"));
    });
  });

  describe("listTopics()", function () {
    it("should list all topics", async function () {
      const topics = [
        { topic_name: "topic-1", cluster_id: "cluster-123" },
        { topic_name: "topic-2", cluster_id: "cluster-123" },
      ];
      fetchStub.resolves(mockListResponse(topics));

      const result = await proxy.listTopics();

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].topic_name, "topic-1");
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/kafka/v3/clusters/cluster-123/topics"));
    });

    it("should include authorized operations when requested", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listTopics({ includeAuthorizedOperations: true });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("includeAuthorizedOperations=true"));
    });
  });

  describe("getTopic()", function () {
    it("should get a specific topic", async function () {
      const topicData = {
        kind: "KafkaTopic",
        topic_name: "my-topic",
        cluster_id: "cluster-123",
        partitions_count: 3,
        replication_factor: 3,
      };
      fetchStub.resolves(mockResponse(topicData));

      const result = await proxy.getTopic("my-topic");

      assert.strictEqual(result.topic_name, "my-topic");
      assert.strictEqual(result.partitions_count, 3);
    });

    it("should encode topic name in URL", async function () {
      fetchStub.resolves(mockResponse({ topic_name: "my/topic" }));

      await proxy.getTopic("my/topic");

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("my%2Ftopic"));
    });
  });

  describe("createTopic()", function () {
    it("should create a topic with basic options", async function () {
      const createdTopic = {
        kind: "KafkaTopic",
        topic_name: "new-topic",
        cluster_id: "cluster-123",
      };
      fetchStub.resolves(mockResponse(createdTopic));

      const result = await proxy.createTopic({ topicName: "new-topic" });

      assert.strictEqual(result.topic_name, "new-topic");
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.strictEqual(body.topic_name, "new-topic");
    });

    it("should create topic with partition and replication settings", async function () {
      fetchStub.resolves(mockResponse({ topic_name: "new-topic" }));

      await proxy.createTopic({
        topicName: "new-topic",
        partitionsCount: 6,
        replicationFactor: 3,
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.partitions_count, 6);
      assert.strictEqual(body.replication_factor, 3);
    });

    it("should create topic with configurations", async function () {
      fetchStub.resolves(mockResponse({ topic_name: "new-topic" }));

      await proxy.createTopic({
        topicName: "new-topic",
        configs: [
          { name: "retention.ms", value: "86400000" },
          { name: "cleanup.policy", value: "compact" },
        ],
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.configs.length, 2);
      assert.strictEqual(body.configs[0].name, "retention.ms");
      assert.strictEqual(body.configs[0].value, "86400000");
    });
  });

  describe("deleteTopic()", function () {
    it("should delete a topic", async function () {
      fetchStub.resolves(mockResponse(null, 204));

      await proxy.deleteTopic("topic-to-delete");

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/topics/topic-to-delete"));
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "DELETE");
    });
  });

  describe("listPartitions()", function () {
    it("should list partitions for a topic", async function () {
      const partitions = [
        { partition_id: 0, topic_name: "my-topic", cluster_id: "cluster-123" },
        { partition_id: 1, topic_name: "my-topic", cluster_id: "cluster-123" },
      ];
      fetchStub.resolves(mockListResponse(partitions));

      const result = await proxy.listPartitions("my-topic");

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].partition_id, 0);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/topics/my-topic/partitions"));
    });
  });

  describe("getPartition()", function () {
    it("should get a specific partition", async function () {
      const partitionData = {
        kind: "KafkaPartition",
        partition_id: 2,
        topic_name: "my-topic",
        cluster_id: "cluster-123",
      };
      fetchStub.resolves(mockResponse(partitionData));

      const result = await proxy.getPartition("my-topic", 2);

      assert.strictEqual(result.partition_id, 2);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/topics/my-topic/partitions/2"));
    });
  });

  describe("listTopicConfigs()", function () {
    it("should list topic configurations", async function () {
      const configs = [
        { name: "retention.ms", value: "604800000", is_default: true },
        { name: "cleanup.policy", value: "delete", is_default: true },
      ];
      fetchStub.resolves(mockListResponse(configs));

      const result = await proxy.listTopicConfigs("my-topic");

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].name, "retention.ms");
    });
  });

  describe("getTopicConfig()", function () {
    it("should get a specific topic configuration", async function () {
      const configData = {
        kind: "KafkaTopicConfig",
        name: "retention.ms",
        value: "604800000",
        is_default: true,
      };
      fetchStub.resolves(mockResponse(configData));

      const result = await proxy.getTopicConfig("my-topic", "retention.ms");

      assert.strictEqual(result.name, "retention.ms");
      assert.strictEqual(result.value, "604800000");
    });
  });

  describe("updateTopicConfigs()", function () {
    it("should update topic configurations", async function () {
      fetchStub.resolves(mockResponse(null, 204));

      await proxy.updateTopicConfigs({
        topicName: "my-topic",
        configs: [
          { name: "retention.ms", operation: "SET", value: "86400000" },
          { name: "max.message.bytes", operation: "DELETE" },
        ],
      });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/topics/my-topic/configs:alter"));
      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.data.length, 2);
      assert.strictEqual(body.data[0].name, "retention.ms");
      assert.strictEqual(body.data[0].operation, "SET");
    });
  });

  describe("produceRecord()", function () {
    it("should produce a simple record", async function () {
      const produceResponse = {
        cluster_id: "cluster-123",
        topic_name: "my-topic",
        partition_id: 0,
        offset: 42,
        timestamp: "2024-01-01T00:00:00Z",
      };
      fetchStub.resolves(mockResponse(produceResponse));

      const result = await proxy.produceRecord({
        topicName: "my-topic",
        value: { type: "JSON", data: { message: "hello" } },
      });

      assert.strictEqual(result.offset, 42);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/topics/my-topic/records"));
    });

    it("should produce record with key and headers", async function () {
      fetchStub.resolves(mockResponse({ offset: 100 }));

      await proxy.produceRecord({
        topicName: "my-topic",
        key: { type: "STRING", data: "my-key" },
        value: { type: "JSON", data: { message: "hello" } },
        headers: [{ name: "trace-id", value: "abc123" }],
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.key.type, "STRING");
      assert.strictEqual(body.key.data, "my-key");
      assert.strictEqual(body.headers.length, 1);
      assert.strictEqual(body.headers[0].name, "trace-id");
    });

    it("should produce to specific partition", async function () {
      fetchStub.resolves(mockResponse({ offset: 100 }));

      await proxy.produceRecord({
        topicName: "my-topic",
        partitionId: 3,
        value: { type: "STRING", data: "test" },
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.partition_id, 3);
    });

    it("should support schema-based serialization", async function () {
      fetchStub.resolves(mockResponse({ offset: 100 }));

      await proxy.produceRecord({
        topicName: "my-topic",
        value: {
          type: "AVRO",
          data: { field1: "value1" },
          schemaId: 12345,
        },
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.value.type, "AVRO");
      assert.strictEqual(body.value.schema_id, 12345);
    });
  });

  describe("topicExists()", function () {
    it("should return true when topic exists", async function () {
      fetchStub.resolves(mockResponse({ topic_name: "existing-topic" }));

      const result = await proxy.topicExists("existing-topic");

      assert.strictEqual(result, true);
    });

    it("should return false when topic does not exist", async function () {
      fetchStub.resolves(mockResponse({ error: "Not found" }, 404));

      const result = await proxy.topicExists("non-existent-topic");

      assert.strictEqual(result, false);
    });

    it("should throw on other errors", async function () {
      fetchStub.resolves(mockResponse({ error: "Server error" }, 500));

      await assert.rejects(() => proxy.topicExists("some-topic"), HttpError);
    });
  });

  describe("createKafkaRestProxy()", function () {
    it("should create a proxy with config", function () {
      const testProxy = createKafkaRestProxy(defaultConfig);

      assert.strictEqual(testProxy.getClusterId(), "cluster-123");
    });
  });

  describe("URL encoding", function () {
    it("should properly encode special characters in topic names", async function () {
      fetchStub.resolves(mockResponse({ topic_name: "topic.with.dots" }));

      await proxy.getTopic("topic.with.dots");

      const url = fetchStub.firstCall.args[0];
      // Dots are safe in URLs, but slashes are encoded
      assert.ok(url.includes("topic.with.dots"));
    });

    it("should encode cluster ID in URL", async function () {
      const proxyWithSpecialClusterId = new KafkaRestProxy({
        ...defaultConfig,
        clusterId: "cluster/special",
      });
      fetchStub.resolves(mockResponse({ kind: "ClusterData" }));

      await proxyWithSpecialClusterId.getCluster();

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("cluster%2Fspecial"));
    });
  });
});
