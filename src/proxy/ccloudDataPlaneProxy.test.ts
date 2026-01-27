import * as assert from "assert";
import * as sinon from "sinon";
import { CCloudDataPlaneProxy, createCCloudDataPlaneProxy } from "./ccloudDataPlaneProxy";
import type { CCloudDataPlaneProxyConfig } from "./ccloudDataPlaneProxy";

describe("proxy/ccloudDataPlaneProxy", function () {
  let fetchStub: sinon.SinonStub;
  let proxy: CCloudDataPlaneProxy;

  const defaultConfig: CCloudDataPlaneProxyConfig = {
    baseUrl: "https://flink.us-east-1.aws.confluent.cloud",
    organizationId: "org-123",
    environmentId: "env-456",
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
      api_version: "sql/v1",
      kind: "StatementList",
      metadata: {
        ...metadata,
      },
      data,
    });
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
    proxy = new CCloudDataPlaneProxy(defaultConfig);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("constructor", function () {
    it("should create proxy with config", function () {
      const testProxy = new CCloudDataPlaneProxy(defaultConfig);

      assert.strictEqual(testProxy.getOrganizationId(), "org-123");
      assert.strictEqual(testProxy.getEnvironmentId(), "env-456");
    });

    it("should accept auth configuration", function () {
      const configWithAuth: CCloudDataPlaneProxyConfig = {
        ...defaultConfig,
        auth: { type: "bearer", token: "dp-token-abc" },
      };

      const testProxy = new CCloudDataPlaneProxy(configWithAuth);
      fetchStub.resolves(mockListResponse([]));

      void testProxy.listStatements();

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer dp-token-abc");
    });

    it("should include custom headers", function () {
      const configWithHeaders: CCloudDataPlaneProxyConfig = {
        ...defaultConfig,
        headers: {
          "x-ccloud-provider": "aws",
          "x-ccloud-region": "us-east-1",
        },
      };

      const testProxy = new CCloudDataPlaneProxy(configWithHeaders);
      fetchStub.resolves(mockListResponse([]));

      void testProxy.listStatements();

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["x-ccloud-provider"], "aws");
      assert.strictEqual(options.headers["x-ccloud-region"], "us-east-1");
    });
  });

  describe("createStatement()", function () {
    it("should create a statement", async function () {
      fetchStub.resolves(
        mockResponse({
          name: "stmt-abc123",
          spec: { statement: "SELECT * FROM t1" },
          status: { phase: "PENDING" },
        }),
      );

      const result = await proxy.createStatement({
        statement: "SELECT * FROM t1",
        computePoolId: "lfcp-xyz",
      });

      assert.strictEqual(result.name, "stmt-abc123");
      assert.strictEqual(result.status?.phase, "PENDING");

      const [url, options] = fetchStub.firstCall.args;
      assert.ok(
        String(url).includes("/sql/v1/organizations/org-123/environments/env-456/statements"),
      );
      assert.strictEqual(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.strictEqual(body.spec.statement, "SELECT * FROM t1");
      assert.strictEqual(body.spec.compute_pool_id, "lfcp-xyz");
    });

    it("should create statement with properties", async function () {
      fetchStub.resolves(mockResponse({ name: "stmt-1" }));

      await proxy.createStatement({
        statement: "SELECT 1",
        properties: { "sql.state-ttl": "1 hour" },
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.spec.properties["sql.state-ttl"], "1 hour");
    });
  });

  describe("listStatements()", function () {
    it("should list statements", async function () {
      const statements = [
        { name: "stmt-1", status: { phase: "RUNNING" } },
        { name: "stmt-2", status: { phase: "COMPLETED" } },
      ];
      fetchStub.resolves(mockListResponse(statements));

      const result = await proxy.listStatements();

      assert.strictEqual(result.data.length, 2);
      assert.strictEqual(result.data[0].name, "stmt-1");
    });

    it("should filter by compute pool", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listStatements({ computePoolId: "lfcp-123" });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("spec_compute_pool_id=lfcp-123"));
    });

    it("should support pagination", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listStatements({ pageSize: 50, pageToken: "token123" });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("page_size=50"));
      assert.ok(url.includes("page_token=token123"));
    });
  });

  describe("getStatement()", function () {
    it("should get a statement by name", async function () {
      fetchStub.resolves(
        mockResponse({
          name: "my-statement",
          spec: { statement: "SELECT * FROM orders" },
          status: { phase: "RUNNING" },
        }),
      );

      const result = await proxy.getStatement("my-statement");

      assert.strictEqual(result.name, "my-statement");
      assert.strictEqual(result.status?.phase, "RUNNING");
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("/statements/my-statement"));
    });
  });

  describe("updateStatement()", function () {
    it("should update a statement", async function () {
      fetchStub.resolves(mockResponse({ name: "stmt-1", spec: { stopped: true } }));

      const result = await proxy.updateStatement("stmt-1", { stopped: true });

      assert.strictEqual(result.spec?.stopped, true);
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "PUT");
    });
  });

  describe("stopStatement()", function () {
    it("should stop a statement", async function () {
      fetchStub.resolves(
        mockResponse({
          name: "stmt-1",
          spec: { stopped: true },
          status: { phase: "STOPPED" },
        }),
      );

      const result = await proxy.stopStatement("stmt-1");

      assert.strictEqual(result.status?.phase, "STOPPED");
      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.spec.stopped, true);
    });
  });

  describe("deleteStatement()", function () {
    it("should delete a statement", async function () {
      fetchStub.resolves(mockResponse(null, 204));

      await proxy.deleteStatement("stmt-to-delete");

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("/statements/stmt-to-delete"));
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "DELETE");
    });
  });

  describe("getStatementResults()", function () {
    it("should get statement results", async function () {
      fetchStub.resolves(
        mockResponse({
          api_version: "sql/v1",
          kind: "StatementResult",
          results: {
            data: [{ op: 0, row: ["value1", 123] }],
          },
        }),
      );

      const result = await proxy.getStatementResults("my-statement");

      assert.ok(result.results?.data);
      assert.strictEqual(result.results.data.length, 1);
    });

    it("should support pagination", async function () {
      fetchStub.resolves(mockResponse({ results: {} }));

      await proxy.getStatementResults("my-statement", "page-token-xyz");

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("page_token=page-token-xyz"));
    });
  });

  describe("getStatementExceptions()", function () {
    it("should get statement exceptions", async function () {
      const exceptions = [
        { name: "exc-1", message: "Error occurred" },
        { name: "exc-2", message: "Another error" },
      ];
      fetchStub.resolves(mockListResponse(exceptions));

      const result = await proxy.getStatementExceptions("failing-statement");

      assert.strictEqual(result.data.length, 2);
      assert.strictEqual(result.data[0].message, "Error occurred");
    });
  });

  describe("createWorkspace()", function () {
    it("should create a workspace", async function () {
      fetchStub.resolves(
        mockResponse({
          name: "my-workspace",
          spec: { blocks: [{ content: "SELECT 1" }] },
        }),
      );

      const result = await proxy.createWorkspace({
        name: "my-workspace",
        computePoolId: "lfcp-123",
        blocks: [{ content: "SELECT 1" }],
      });

      assert.strictEqual(result.name, "my-workspace");
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("/ws/v1/organizations/org-123/environments/env-456/workspaces"));
    });
  });

  describe("listWorkspaces()", function () {
    it("should list workspaces", async function () {
      const workspaces = [
        { name: "ws-1", status: { phase: "ACTIVE" } },
        { name: "ws-2", status: { phase: "ACTIVE" } },
      ];
      fetchStub.resolves(mockListResponse(workspaces));

      const result = await proxy.listWorkspaces();

      assert.strictEqual(result.data.length, 2);
    });

    it("should filter by compute pool and include all", async function () {
      fetchStub.resolves(mockListResponse([]));

      await proxy.listWorkspaces({ computePoolId: "lfcp-456", all: true });

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("spec_compute_pool=lfcp-456"));
      assert.ok(url.includes("all=true"));
    });
  });

  describe("getWorkspace()", function () {
    it("should get a workspace by name", async function () {
      fetchStub.resolves(
        mockResponse({
          name: "my-workspace",
          spec: { blocks: [] },
        }),
      );

      const result = await proxy.getWorkspace("my-workspace");

      assert.strictEqual(result.name, "my-workspace");
    });
  });

  describe("updateWorkspace()", function () {
    it("should update a workspace", async function () {
      fetchStub.resolves(
        mockResponse({
          name: "my-workspace",
          spec: { blocks: [{ content: "SELECT 2" }] },
        }),
      );

      const result = await proxy.updateWorkspace("my-workspace", {
        blocks: [{ content: "SELECT 2" }],
      });

      assert.strictEqual(result.spec?.blocks?.[0].content, "SELECT 2");
    });
  });

  describe("deleteWorkspace()", function () {
    it("should delete a workspace", async function () {
      fetchStub.resolves(mockResponse(null, 204));

      await proxy.deleteWorkspace("ws-to-delete");

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("/workspaces/ws-to-delete"));
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "DELETE");
    });
  });

  describe("fetchAllStatements()", function () {
    it("should fetch all pages of statements", async function () {
      fetchStub.onCall(0).resolves(
        mockListResponse([{ name: "stmt-1" }], {
          next: "https://flink.example.com/sql/v1/organizations/org-123/environments/env-456/statements?page_token=token2",
        }),
      );
      fetchStub.onCall(1).resolves(mockListResponse([{ name: "stmt-2" }]));

      const result = await proxy.fetchAllStatements();

      assert.strictEqual(result.length, 2);
      assert.strictEqual(fetchStub.callCount, 2);
    });
  });

  describe("fetchAllWorkspaces()", function () {
    it("should fetch all pages of workspaces", async function () {
      fetchStub.onCall(0).resolves(
        mockListResponse([{ name: "ws-1" }], {
          next: "https://flink.example.com/ws/v1/organizations/org-123/environments/env-456/workspaces?page_token=token2",
        }),
      );
      fetchStub.onCall(1).resolves(mockListResponse([{ name: "ws-2" }]));

      const result = await proxy.fetchAllWorkspaces();

      assert.strictEqual(result.length, 2);
    });
  });

  describe("createCCloudDataPlaneProxy()", function () {
    it("should create a proxy with config", function () {
      const testProxy = createCCloudDataPlaneProxy(defaultConfig);

      assert.strictEqual(testProxy.getOrganizationId(), "org-123");
      assert.strictEqual(testProxy.getEnvironmentId(), "env-456");
    });
  });

  describe("URL encoding", function () {
    it("should properly encode statement name in URL", async function () {
      fetchStub.resolves(mockResponse({ name: "stmt/special" }));

      await proxy.getStatement("stmt/special");

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("stmt%2Fspecial"));
    });

    it("should properly encode workspace name in URL", async function () {
      fetchStub.resolves(mockResponse({ name: "ws/special" }));

      await proxy.getWorkspace("ws/special");

      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("ws%2Fspecial"));
    });
  });
});
