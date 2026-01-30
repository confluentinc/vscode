import * as assert from "assert";
import * as sinon from "sinon";
import { CCloudControlPlaneProxy, createCCloudControlPlaneProxy } from "./ccloudControlPlaneProxy";
import type { CCloudControlPlaneProxyConfig } from "./ccloudControlPlaneProxy";

describe("proxy/ccloudControlPlaneProxy", function () {
  let fetchStub: sinon.SinonStub;
  let proxy: CCloudControlPlaneProxy;

  const defaultConfig: CCloudControlPlaneProxyConfig = {
    baseUrl: "https://api.confluent.cloud",
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

  function mockListResponse<T>(data: T[], metadata?: { next?: string }): Response {
    return mockResponse({
      api_version: "v2",
      kind: "List",
      metadata: {
        ...metadata,
      },
      data,
    });
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
    proxy = new CCloudControlPlaneProxy(defaultConfig);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("constructor", function () {
    it("should create proxy with config", function () {
      const testProxy = new CCloudControlPlaneProxy(defaultConfig);
      fetchStub.resolves(mockResponse({ id: "user-123" }));

      void testProxy.getCurrentUser();

      assert.ok(fetchStub.calledOnce);
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.startsWith("https://api.confluent.cloud"));
    });

    it("should accept auth configuration", function () {
      const configWithAuth: CCloudControlPlaneProxyConfig = {
        ...defaultConfig,
        auth: { type: "bearer", token: "cp-token-123" },
      };

      const testProxy = new CCloudControlPlaneProxy(configWithAuth);
      fetchStub.resolves(mockResponse({ id: "user-123" }));

      void testProxy.getCurrentUser();

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer cp-token-123");
    });
  });

  describe("getCurrentUser()", function () {
    it("should get current user info", async function () {
      fetchStub.resolves(
        mockResponse({
          id: "u-abc123",
          email: "user@example.com",
          full_name: "Test User",
        }),
      );

      const result = await proxy.getCurrentUser();

      assert.strictEqual(result.id, "u-abc123");
      assert.strictEqual(result.email, "user@example.com");
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("/api/iam/v2/users/me"));
    });
  });

  describe("listOrganizations()", function () {
    it("should list organizations", async function () {
      const orgs = [
        { id: "org-1", display_name: "Org 1" },
        { id: "org-2", display_name: "Org 2" },
      ];
      fetchStub.resolves(mockListResponse(orgs));

      const result = await proxy.listOrganizations();

      assert.strictEqual(result.data.length, 2);
      assert.strictEqual(result.data[0].id, "org-1");
    });

    it("should support pagination", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listOrganizations({ pageSize: 10, pageToken: "abc123" });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("page_size=10"));
      assert.ok(url.includes("page_token=abc123"));
    });
  });

  describe("getOrganization()", function () {
    it("should get a specific organization", async function () {
      fetchStub.resolves(
        mockResponse({
          id: "org-123",
          display_name: "My Organization",
          jit_enabled: true,
        }),
      );

      const result = await proxy.getOrganization("org-123");

      assert.strictEqual(result.id, "org-123");
      assert.strictEqual(result.jit_enabled, true);
    });
  });

  describe("listEnvironments()", function () {
    it("should list environments", async function () {
      const envs = [
        { id: "env-1", display_name: "Production" },
        { id: "env-2", display_name: "Staging" },
      ];
      fetchStub.resolves(mockListResponse(envs));

      const result = await proxy.listEnvironments();

      assert.strictEqual(result.data.length, 2);
      assert.strictEqual(result.data[0].display_name, "Production");
    });

    it("should filter by stream governance package", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listEnvironments({ streamGovernancePackage: "ESSENTIALS" });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("spec.stream_governance_config.package=ESSENTIALS"));
    });
  });

  describe("getEnvironment()", function () {
    it("should get a specific environment", async function () {
      fetchStub.resolves(
        mockResponse({
          id: "env-xyz",
          display_name: "Production",
          stream_governance_config: { package: "ADVANCED" },
        }),
      );

      const result = await proxy.getEnvironment("env-xyz");

      assert.strictEqual(result.id, "env-xyz");
    });
  });

  describe("listKafkaClusters()", function () {
    it("should list Kafka clusters", async function () {
      const clusters = [
        {
          id: "lkc-1",
          spec: { display_name: "Cluster 1", cloud: "aws", region: "us-east-1" },
        },
        {
          id: "lkc-2",
          spec: { display_name: "Cluster 2", cloud: "gcp", region: "us-central1" },
        },
      ];
      fetchStub.resolves(mockListResponse(clusters));

      const result = await proxy.listKafkaClusters();

      assert.strictEqual(result.data.length, 2);
      assert.strictEqual(result.data[0].spec?.cloud, "aws");
    });

    it("should filter by environment", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listKafkaClusters({ environmentId: "env-123" });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("environment=env-123"));
    });
  });

  describe("getKafkaCluster()", function () {
    it("should get a specific Kafka cluster", async function () {
      fetchStub.resolves(
        mockResponse({
          id: "lkc-abc",
          spec: {
            display_name: "My Cluster",
            kafka_bootstrap_endpoint: "pkc-abc.us-east-1.aws.confluent.cloud:9092",
          },
        }),
      );

      const result = await proxy.getKafkaCluster("lkc-abc", "env-123");

      assert.strictEqual(result.id, "lkc-abc");
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("environment=env-123"));
    });
  });

  describe("listSchemaRegistries()", function () {
    it("should list Schema Registries", async function () {
      const srs = [
        {
          id: "lsrc-1",
          spec: { display_name: "SR 1", cloud: "aws", region: "us-east-1" },
        },
      ];
      fetchStub.resolves(mockListResponse(srs));

      const result = await proxy.listSchemaRegistries();

      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].id, "lsrc-1");
    });

    it("should filter by environment", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listSchemaRegistries({ environmentId: "env-456" });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("environment=env-456"));
    });
  });

  describe("getSchemaRegistry()", function () {
    it("should get a specific Schema Registry", async function () {
      fetchStub.resolves(
        mockResponse({
          id: "lsrc-xyz",
          spec: {
            display_name: "My SR",
            http_endpoint: "https://psrc-abc.us-east-1.aws.confluent.cloud",
          },
        }),
      );

      const result = await proxy.getSchemaRegistry("lsrc-xyz", "env-123");

      assert.strictEqual(result.id, "lsrc-xyz");
    });
  });

  describe("listFlinkComputePools()", function () {
    it("should list Flink compute pools", async function () {
      const pools = [
        {
          id: "lfcp-1",
          spec: { display_name: "Pool 1", max_cfu: 10, cloud: "aws", region: "us-east-1" },
        },
      ];
      fetchStub.resolves(mockListResponse(pools));

      const result = await proxy.listFlinkComputePools();

      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].spec?.max_cfu, 10);
    });

    it("should filter by environment and region", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listFlinkComputePools({ environmentId: "env-789", region: "us-west-2" });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("environment=env-789"));
      assert.ok(url.includes("spec.region=us-west-2"));
    });
  });

  describe("getFlinkComputePool()", function () {
    it("should get a specific Flink compute pool", async function () {
      fetchStub.resolves(
        mockResponse({
          id: "lfcp-abc",
          spec: { display_name: "My Pool", max_cfu: 20 },
          status: { phase: "PROVISIONED", current_cfu: 5 },
        }),
      );

      const result = await proxy.getFlinkComputePool("lfcp-abc", "env-123");

      assert.strictEqual(result.id, "lfcp-abc");
      assert.strictEqual(result.status?.current_cfu, 5);
    });
  });

  describe("fetchAllPages()", function () {
    it("should fetch all pages of results", async function () {
      // First page with next link
      fetchStub.onCall(0).resolves(
        mockListResponse([{ id: "env-1" }, { id: "env-2" }], {
          next: "https://api.confluent.cloud/api/org/v2/environments?page_token=token123",
        }),
      );

      // Second page (final)
      fetchStub.onCall(1).resolves(mockListResponse([{ id: "env-3" }]));

      const result = await proxy.fetchAllEnvironments();

      assert.strictEqual(result.length, 3);
      assert.strictEqual(fetchStub.callCount, 2);
    });

    it("should handle single page response", async function () {
      fetchStub.resolves(mockListResponse([{ id: "org-1" }]));

      const result = await proxy.fetchAllOrganizations();

      assert.strictEqual(result.length, 1);
      assert.strictEqual(fetchStub.callCount, 1);
    });
  });

  describe("fetchAllKafkaClusters()", function () {
    it("should fetch all clusters for an environment", async function () {
      fetchStub.resolves(mockListResponse([{ id: "lkc-1" }, { id: "lkc-2" }]));

      const result = await proxy.fetchAllKafkaClusters("env-123");

      assert.strictEqual(result.length, 2);
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("environment=env-123"));
    });
  });

  describe("fetchAllSchemaRegistries()", function () {
    it("should fetch all Schema Registries for an environment", async function () {
      fetchStub.resolves(mockListResponse([{ id: "lsrc-1" }]));

      const result = await proxy.fetchAllSchemaRegistries("env-456");

      assert.strictEqual(result.length, 1);
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("environment=env-456"));
    });
  });

  describe("fetchAllFlinkComputePools()", function () {
    it("should fetch all Flink pools for an environment", async function () {
      fetchStub.resolves(mockListResponse([{ id: "lfcp-1" }, { id: "lfcp-2" }]));

      const result = await proxy.fetchAllFlinkComputePools("env-789");

      assert.strictEqual(result.length, 2);
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("environment=env-789"));
    });
  });

  describe("createCCloudControlPlaneProxy()", function () {
    it("should create a proxy with config", function () {
      const testProxy = createCCloudControlPlaneProxy(defaultConfig);
      fetchStub.resolves(mockResponse({ id: "user-1" }));

      void testProxy.getCurrentUser();

      assert.ok(fetchStub.calledOnce);
    });
  });
});
