import * as assert from "assert";
import * as sinon from "sinon";
import { createTopicFetcher } from "./topicFetcher";
import { TopicFetchError } from "./types";
import { ConnectionType } from "../clients/sidecar";
import type { KafkaCluster } from "../models/kafkaCluster";

describe("fetchers/topicFetcher", function () {
  let fetchStub: sinon.SinonStub;

  const mockCluster: KafkaCluster = {
    connectionId: "test-connection" as any,
    connectionType: ConnectionType.Direct,
    environmentId: "test-env" as any,
    id: "cluster-123",
    name: "Test Cluster",
    bootstrapServers: "localhost:9092",
    uri: "http://localhost:8082",
  } as KafkaCluster;

  function mockResponse<T>(data: T, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response;
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("createTopicFetcher()", function () {
    it("should create a topic fetcher", function () {
      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });
      assert.ok(fetcher);
      assert.ok(typeof fetcher.fetchTopics === "function");
    });
  });

  describe("fetchTopics()", function () {
    it("should fetch topics from cluster", async function () {
      const topicsData = {
        data: [
          {
            topic_name: "topic-1",
            is_internal: false,
            replication_factor: 3,
            partitions_count: 6,
            partitions: {},
            configs: {},
            authorized_operations: ["READ", "WRITE"],
          },
          {
            topic_name: "topic-2",
            is_internal: false,
            replication_factor: 3,
            partitions_count: 3,
            partitions: {},
            configs: {},
          },
        ],
      };
      fetchStub.resolves(mockResponse(topicsData));

      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });

      const topics = await fetcher.fetchTopics(mockCluster);

      assert.strictEqual(topics.length, 2);
      assert.strictEqual(topics[0].topic_name, "topic-1");
      assert.strictEqual(topics[1].topic_name, "topic-2");
    });

    it("should sort topics by name", async function () {
      const topicsData = {
        data: [
          { topic_name: "zebra", is_internal: false, replication_factor: 3, partitions_count: 1 },
          { topic_name: "alpha", is_internal: false, replication_factor: 3, partitions_count: 1 },
          { topic_name: "beta", is_internal: false, replication_factor: 3, partitions_count: 1 },
        ],
      };
      fetchStub.resolves(mockResponse(topicsData));

      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });

      const topics = await fetcher.fetchTopics(mockCluster);

      assert.strictEqual(topics[0].topic_name, "alpha");
      assert.strictEqual(topics[1].topic_name, "beta");
      assert.strictEqual(topics[2].topic_name, "zebra");
    });

    it("should filter out virtual topics with 0 replication factor", async function () {
      const topicsData = {
        data: [
          {
            topic_name: "real-topic",
            is_internal: false,
            replication_factor: 3,
            partitions_count: 1,
          },
          {
            topic_name: "virtual-topic",
            is_internal: false,
            replication_factor: 0,
            partitions_count: 1,
          },
        ],
      };
      fetchStub.resolves(mockResponse(topicsData));

      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });

      const topics = await fetcher.fetchTopics(mockCluster);

      assert.strictEqual(topics.length, 1);
      assert.strictEqual(topics[0].topic_name, "real-topic");
    });

    it("should throw TopicFetchError when cluster has no URI", async function () {
      const clusterWithoutUri = { ...mockCluster, uri: undefined };

      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });

      await assert.rejects(
        () => fetcher.fetchTopics(clusterWithoutUri as KafkaCluster),
        TopicFetchError,
      );
    });

    it("should throw TopicFetchError on HTTP error", async function () {
      fetchStub.resolves(mockResponse({ error: "Not found" }, 404));

      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });

      await assert.rejects(() => fetcher.fetchTopics(mockCluster), TopicFetchError);
    });

    it("should include auth header when provided", async function () {
      const topicsData = { data: [] };
      fetchStub.resolves(mockResponse(topicsData));

      const fetcher = createTopicFetcher({
        getAuthConfig: () => ({ type: "bearer", token: "test-token" }),
      });

      await fetcher.fetchTopics(mockCluster);

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer test-token");
    });

    it("should return empty array when no topics", async function () {
      fetchStub.resolves(mockResponse({ data: [] }));

      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });

      const topics = await fetcher.fetchTopics(mockCluster);

      assert.strictEqual(topics.length, 0);
    });

    it("should handle authorized_operations correctly", async function () {
      const topicsData = {
        data: [
          {
            topic_name: "topic-with-ops",
            is_internal: false,
            replication_factor: 3,
            partitions_count: 1,
            authorized_operations: ["READ", "WRITE", "DELETE"],
          },
        ],
      };
      fetchStub.resolves(mockResponse(topicsData));

      const fetcher = createTopicFetcher({
        getAuthConfig: () => undefined,
      });

      const topics = await fetcher.fetchTopics(mockCluster);

      assert.deepStrictEqual(topics[0].authorized_operations, ["READ", "WRITE", "DELETE"]);
    });
  });
});
