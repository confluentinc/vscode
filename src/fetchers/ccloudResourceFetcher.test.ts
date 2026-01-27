import * as assert from "assert";
import * as sinon from "sinon";
import { createCCloudResourceFetcher } from "./ccloudResourceFetcher";
import type { EnvironmentId } from "../models/resource";

describe("fetchers/ccloudResourceFetcher", function () {
  let fetchStub: sinon.SinonStub;

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

  function mockListResponse<T>(data: T[], metadata?: { next?: string }): Response {
    return mockResponse({
      api_version: "v2",
      kind: "List",
      metadata: { ...metadata },
      data,
    });
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("createCCloudResourceFetcher()", function () {
    it("should create a ccloud resource fetcher", function () {
      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });
      assert.ok(fetcher);
      assert.ok(typeof fetcher.fetchEnvironments === "function");
      assert.ok(typeof fetcher.fetchKafkaClusters === "function");
      assert.ok(typeof fetcher.fetchSchemaRegistries === "function");
      assert.ok(typeof fetcher.fetchFlinkComputePools === "function");
    });
  });

  describe("fetchEnvironments()", function () {
    it("should fetch environments with nested resources", async function () {
      // Mock environments response
      fetchStub.onCall(0).resolves(
        mockListResponse([
          {
            id: "env-123",
            display_name: "Production",
            stream_governance_config: { package: "ESSENTIALS" },
          },
        ]),
      );
      // Mock kafka clusters response
      fetchStub.onCall(1).resolves(
        mockListResponse([
          {
            id: "lkc-abc",
            spec: {
              display_name: "Main Cluster",
              kafka_bootstrap_endpoint: "pkc-abc.us-east-1.aws.confluent.cloud:9092",
              http_endpoint: "https://pkc-abc.us-east-1.aws.confluent.cloud:443",
              cloud: "aws",
              region: "us-east-1",
            },
          },
        ]),
      );
      // Mock schema registries response
      fetchStub.onCall(2).resolves(
        mockListResponse([
          {
            id: "lsrc-xyz",
            spec: {
              http_endpoint: "https://psrc-xyz.us-east-1.aws.confluent.cloud",
              cloud: "aws",
              region: "us-east-1",
            },
          },
        ]),
      );
      // Mock flink compute pools response
      fetchStub.onCall(3).resolves(
        mockListResponse([
          {
            id: "lfcp-123",
            spec: {
              display_name: "Flink Pool",
              cloud: "aws",
              region: "us-east-1",
              max_cfu: 10,
            },
          },
        ]),
      );

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const environments = await fetcher.fetchEnvironments();

      assert.strictEqual(environments.length, 1);
      assert.strictEqual(environments[0].id, "env-123");
      assert.strictEqual(environments[0].name, "Production");
      assert.strictEqual(environments[0].streamGovernancePackage, "ESSENTIALS");
      assert.strictEqual(environments[0].kafkaClusters.length, 1);
      assert.strictEqual(environments[0].kafkaClusters[0].id, "lkc-abc");
      assert.ok(environments[0].schemaRegistry);
      assert.strictEqual(environments[0].schemaRegistry!.id, "lsrc-xyz");
      assert.strictEqual(environments[0].flinkComputePools.length, 1);
    });

    it("should sort environments by name", async function () {
      fetchStub.onCall(0).resolves(
        mockListResponse([
          { id: "env-2", display_name: "Zebra" },
          { id: "env-1", display_name: "Alpha" },
        ]),
      );
      // Empty responses for nested resources
      fetchStub.onCall(1).resolves(mockListResponse([]));
      fetchStub.onCall(2).resolves(mockListResponse([]));
      fetchStub.onCall(3).resolves(mockListResponse([]));
      fetchStub.onCall(4).resolves(mockListResponse([]));
      fetchStub.onCall(5).resolves(mockListResponse([]));
      fetchStub.onCall(6).resolves(mockListResponse([]));

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const environments = await fetcher.fetchEnvironments();

      assert.strictEqual(environments[0].name, "Alpha");
      assert.strictEqual(environments[1].name, "Zebra");
    });

    it("should associate Flink pools with Kafka clusters in same region", async function () {
      fetchStub.onCall(0).resolves(mockListResponse([{ id: "env-123", display_name: "Test Env" }]));
      // Kafka cluster in us-east-1
      fetchStub.onCall(1).resolves(
        mockListResponse([
          {
            id: "lkc-1",
            spec: {
              display_name: "Cluster 1",
              kafka_bootstrap_endpoint: "bootstrap:9092",
              cloud: "aws",
              region: "us-east-1",
            },
          },
        ]),
      );
      fetchStub.onCall(2).resolves(mockListResponse([]));
      // Flink pool in us-east-1 (should be associated)
      fetchStub.onCall(3).resolves(
        mockListResponse([
          {
            id: "lfcp-1",
            spec: {
              display_name: "Pool 1",
              cloud: "aws",
              region: "us-east-1",
              max_cfu: 10,
            },
          },
        ]),
      );

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const environments = await fetcher.fetchEnvironments();
      const cluster = environments[0].kafkaClusters[0];

      // Cluster should have associated Flink pool
      assert.ok(cluster.flinkPools);
      assert.strictEqual(cluster.flinkPools.length, 1);
      assert.strictEqual(cluster.flinkPools[0].id, "lfcp-1");
    });

    it("should handle environment with no schema registry", async function () {
      fetchStub
        .onCall(0)
        .resolves(mockListResponse([{ id: "env-123", display_name: "No SR Env" }]));
      fetchStub.onCall(1).resolves(mockListResponse([]));
      fetchStub.onCall(2).resolves(mockListResponse([])); // No schema registry
      fetchStub.onCall(3).resolves(mockListResponse([]));

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const environments = await fetcher.fetchEnvironments();

      assert.strictEqual(environments[0].schemaRegistry, undefined);
    });

    it("should include auth header when token provided", async function () {
      fetchStub.resolves(mockListResponse([]));

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "my-oauth-token",
      });

      await fetcher.fetchEnvironments();

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer my-oauth-token");
    });

    it("should use default stream governance package when not provided", async function () {
      fetchStub.onCall(0).resolves(mockListResponse([{ id: "env-123", display_name: "Test Env" }]));
      fetchStub.onCall(1).resolves(mockListResponse([]));
      fetchStub.onCall(2).resolves(mockListResponse([]));
      fetchStub.onCall(3).resolves(mockListResponse([]));

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const environments = await fetcher.fetchEnvironments();

      assert.strictEqual(environments[0].streamGovernancePackage, "NONE");
    });
  });

  describe("fetchKafkaClusters()", function () {
    it("should fetch Kafka clusters for an environment", async function () {
      fetchStub.resolves(
        mockListResponse([
          {
            id: "lkc-123",
            spec: {
              display_name: "Test Cluster",
              kafka_bootstrap_endpoint: "bootstrap:9092",
              http_endpoint: "https://rest-endpoint:443",
              cloud: "gcp",
              region: "us-central1",
            },
          },
        ]),
      );

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const clusters = await fetcher.fetchKafkaClusters("env-123" as EnvironmentId);

      assert.strictEqual(clusters.length, 1);
      assert.strictEqual(clusters[0].id, "lkc-123");
      assert.strictEqual(clusters[0].name, "Test Cluster");
      assert.strictEqual(clusters[0].bootstrapServers, "bootstrap:9092");
      assert.strictEqual(clusters[0].uri, "https://rest-endpoint:443");
      assert.strictEqual(clusters[0].provider, "gcp");
      assert.strictEqual(clusters[0].region, "us-central1");
    });

    it("should return empty array when no clusters", async function () {
      fetchStub.resolves(mockListResponse([]));

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const clusters = await fetcher.fetchKafkaClusters("env-123" as EnvironmentId);

      assert.strictEqual(clusters.length, 0);
    });
  });

  describe("fetchSchemaRegistries()", function () {
    it("should fetch Schema Registries for an environment", async function () {
      fetchStub.resolves(
        mockListResponse([
          {
            id: "lsrc-456",
            spec: {
              http_endpoint: "https://psrc-456.aws.confluent.cloud",
              cloud: "aws",
              region: "eu-west-1",
            },
          },
        ]),
      );

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const registries = await fetcher.fetchSchemaRegistries("env-123" as EnvironmentId);

      assert.strictEqual(registries.length, 1);
      assert.strictEqual(registries[0].id, "lsrc-456");
      assert.strictEqual(registries[0].uri, "https://psrc-456.aws.confluent.cloud");
      assert.strictEqual(registries[0].provider, "aws");
      assert.strictEqual(registries[0].region, "eu-west-1");
    });
  });

  describe("fetchFlinkComputePools()", function () {
    it("should fetch Flink compute pools for an environment", async function () {
      fetchStub.resolves(
        mockListResponse([
          {
            id: "lfcp-789",
            spec: {
              display_name: "Analytics Pool",
              cloud: "azure",
              region: "eastus2",
              max_cfu: 20,
            },
          },
        ]),
      );

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const pools = await fetcher.fetchFlinkComputePools("env-123" as EnvironmentId);

      assert.strictEqual(pools.length, 1);
      assert.strictEqual(pools[0].id, "lfcp-789");
      assert.strictEqual(pools[0].name, "Analytics Pool");
      assert.strictEqual(pools[0].provider, "azure");
      assert.strictEqual(pools[0].region, "eastus2");
      assert.strictEqual(pools[0].maxCfu, 20);
    });

    it("should return empty array when no pools", async function () {
      fetchStub.resolves(mockListResponse([]));

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
      });

      const pools = await fetcher.fetchFlinkComputePools("env-123" as EnvironmentId);

      assert.strictEqual(pools.length, 0);
    });
  });

  describe("custom base URL", function () {
    it("should use custom base URL when provided", async function () {
      fetchStub.resolves(mockListResponse([]));

      const fetcher = createCCloudResourceFetcher({
        getAccessToken: async () => "test-token",
        baseUrl: "https://custom.api.confluent.cloud",
      });

      await fetcher.fetchEnvironments();

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.startsWith("https://custom.api.confluent.cloud"));
    });
  });
});
