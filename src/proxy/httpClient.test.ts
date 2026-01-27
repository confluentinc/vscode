import * as assert from "assert";
import * as sinon from "sinon";
import { HttpClient, HttpError, TimeoutError, createHttpClient } from "./httpClient";
import type { AuthConfig, HttpClientConfig } from "./httpClient";

describe("proxy/httpClient", function () {
  let fetchStub: sinon.SinonStub;
  let client: HttpClient;

  const defaultConfig: HttpClientConfig = {
    baseUrl: "https://api.example.com",
    timeout: 5000,
    maxRetries: 2,
    retryDelay: 100,
  };

  function mockResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({
        "content-type": "application/json",
        ...headers,
      }),
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response;
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
    client = new HttpClient(defaultConfig);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("constructor", function () {
    it("should create client with config", function () {
      const config: HttpClientConfig = {
        baseUrl: "https://test.com",
      };

      const testClient = new HttpClient(config);

      // Verify by making a request
      fetchStub.resolves(mockResponse({ test: true }));
      testClient.get("/test");

      assert.ok(fetchStub.calledOnce);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.startsWith("https://test.com"));
    });

    it("should remove trailing slash from base URL", function () {
      const config: HttpClientConfig = {
        baseUrl: "https://test.com/",
      };

      const testClient = new HttpClient(config);
      fetchStub.resolves(mockResponse({}));
      testClient.get("/path");

      const url = fetchStub.firstCall.args[0];
      assert.ok(!url.includes("//path"));
    });
  });

  describe("get()", function () {
    it("should make GET request", async function () {
      fetchStub.resolves(mockResponse({ result: "data" }));

      const response = await client.get("/test");

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.data, { result: "data" });
      assert.strictEqual(response.ok, true);
    });

    it("should include query parameters", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.get("/test", { params: { foo: "bar", num: 123 } });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("foo=bar"));
      assert.ok(url.includes("num=123"));
    });

    it("should skip undefined query parameters", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.get("/test", { params: { foo: "bar", skip: undefined } });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("foo=bar"));
      assert.ok(!url.includes("skip"));
    });
  });

  describe("post()", function () {
    it("should make POST request with body", async function () {
      fetchStub.resolves(mockResponse({ id: 1 }));

      const response = await client.post("/items", { name: "test" });

      assert.strictEqual(response.status, 200);
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "POST");
      assert.strictEqual(options.body, '{"name":"test"}');
    });

    it("should handle string body", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.post("/items", "raw body");

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.body, "raw body");
    });
  });

  describe("put()", function () {
    it("should make PUT request", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.put("/items/1", { name: "updated" });

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "PUT");
    });
  });

  describe("patch()", function () {
    it("should make PATCH request", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.patch("/items/1", { name: "patched" });

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "PATCH");
    });
  });

  describe("delete()", function () {
    it("should make DELETE request", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.delete("/items/1");

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "DELETE");
    });
  });

  describe("authentication", function () {
    it("should add bearer token", async function () {
      const authConfig: AuthConfig = { type: "bearer", token: "test-token" };
      const authClient = new HttpClient({ ...defaultConfig, auth: authConfig });
      fetchStub.resolves(mockResponse({}));

      await authClient.get("/test");

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer test-token");
    });

    it("should add basic auth", async function () {
      const authConfig: AuthConfig = { type: "basic", username: "user", password: "pass" };
      const authClient = new HttpClient({ ...defaultConfig, auth: authConfig });
      fetchStub.resolves(mockResponse({}));

      await authClient.get("/test");

      const [, options] = fetchStub.firstCall.args;
      const expected = "Basic " + Buffer.from("user:pass").toString("base64");
      assert.strictEqual(options.headers["Authorization"], expected);
    });

    it("should add api-key auth", async function () {
      const authConfig: AuthConfig = { type: "api-key", apiKey: "key", apiSecret: "secret" };
      const authClient = new HttpClient({ ...defaultConfig, auth: authConfig });
      fetchStub.resolves(mockResponse({}));

      await authClient.get("/test");

      const [, options] = fetchStub.firstCall.args;
      const expected = "Basic " + Buffer.from("key:secret").toString("base64");
      assert.strictEqual(options.headers["Authorization"], expected);
    });

    it("should skip auth with type none", async function () {
      const authConfig: AuthConfig = { type: "none" };
      const authClient = new HttpClient({ ...defaultConfig, auth: authConfig });
      fetchStub.resolves(mockResponse({}));

      await authClient.get("/test");

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], undefined);
    });

    it("should override default auth per request", async function () {
      const defaultAuth: AuthConfig = { type: "bearer", token: "default" };
      const authClient = new HttpClient({ ...defaultConfig, auth: defaultAuth });
      fetchStub.resolves(mockResponse({}));

      await authClient.get("/test", { auth: { type: "bearer", token: "override" } });

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer override");
    });
  });

  describe("headers", function () {
    it("should include default headers", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.get("/test");

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Content-Type"], "application/json");
      assert.strictEqual(options.headers["Accept"], "application/json");
    });

    it("should merge custom headers", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.get("/test", { headers: { "X-Custom": "value" } });

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["X-Custom"], "value");
      assert.strictEqual(options.headers["Content-Type"], "application/json");
    });

    it("should allow overriding default headers", async function () {
      fetchStub.resolves(mockResponse({}));

      await client.get("/test", { headers: { "Content-Type": "text/plain" } });

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Content-Type"], "text/plain");
    });
  });

  describe("error handling", function () {
    it("should throw HttpError on 4xx response", async function () {
      fetchStub.resolves(mockResponse({ error: "Not found" }, 404));

      await assert.rejects(() => client.get("/notfound"), HttpError);
    });

    it("should throw HttpError on 5xx response", async function () {
      fetchStub.resolves(mockResponse({ error: "Server error" }, 500));

      await assert.rejects(() => client.get("/error"), HttpError);
    });

    it("should include response data in HttpError", async function () {
      const errorData = { code: "ERR_001", message: "Something failed" };
      fetchStub.resolves(mockResponse(errorData, 400));

      try {
        await client.get("/error");
        assert.fail("Should have thrown");
      } catch (error) {
        assert.ok(error instanceof HttpError);
        assert.strictEqual(error.status, 400);
        assert.deepStrictEqual(error.data, errorData);
        assert.strictEqual(error.isClientError, true);
        assert.strictEqual(error.isServerError, false);
      }
    });

    it("should identify retryable errors", function () {
      const serverError = new HttpError("Server Error", 500, "Internal Server Error");
      const tooManyRequests = new HttpError("Too Many Requests", 429, "Too Many Requests");
      const notFound = new HttpError("Not Found", 404, "Not Found");

      assert.strictEqual(serverError.isRetryable, true);
      assert.strictEqual(tooManyRequests.isRetryable, true);
      assert.strictEqual(notFound.isRetryable, false);
    });
  });

  describe("retry logic", function () {
    it("should retry on server error", async function () {
      fetchStub
        .onCall(0)
        .resolves(mockResponse({ error: "Server error" }, 500))
        .onCall(1)
        .resolves(mockResponse({ success: true }));

      const response = await client.get("/flaky");

      assert.strictEqual(fetchStub.callCount, 2);
      assert.deepStrictEqual(response.data, { success: true });
    });

    it("should not retry on client error", async function () {
      fetchStub.resolves(mockResponse({ error: "Bad request" }, 400));

      await assert.rejects(() => client.get("/bad"), HttpError);

      assert.strictEqual(fetchStub.callCount, 1);
    });

    it("should retry on 429 Too Many Requests", async function () {
      fetchStub
        .onCall(0)
        .resolves(mockResponse({}, 429))
        .onCall(1)
        .resolves(mockResponse({ success: true }));

      const response = await client.get("/limited");

      assert.strictEqual(fetchStub.callCount, 2);
      assert.strictEqual(response.ok, true);
    });

    it("should respect maxRetries option", async function () {
      fetchStub.resolves(mockResponse({}, 500));

      await assert.rejects(() => client.get("/error", { maxRetries: 1 }), HttpError);

      // Initial attempt + 1 retry = 2 calls
      assert.strictEqual(fetchStub.callCount, 2);
    });

    it("should skip retry with noRetry option", async function () {
      fetchStub.resolves(mockResponse({}, 500));

      await assert.rejects(() => client.get("/error", { noRetry: true }), HttpError);

      assert.strictEqual(fetchStub.callCount, 1);
    });
  });

  describe("timeout", function () {
    it("should timeout long requests", async function () {
      // Create a fetch that respects abort signal
      fetchStub.callsFake(
        (_url: string, options: RequestInit) =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => resolve(mockResponse({})), 10000);
            options.signal?.addEventListener("abort", () => {
              clearTimeout(timeout);
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );

      const shortTimeoutClient = new HttpClient({ ...defaultConfig, timeout: 100 });

      await assert.rejects(() => shortTimeoutClient.get("/slow"), TimeoutError);
    });

    it("should respect per-request timeout", async function () {
      fetchStub.callsFake(
        (_url: string, options: RequestInit) =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => resolve(mockResponse({})), 10000);
            options.signal?.addEventListener("abort", () => {
              clearTimeout(timeout);
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      );

      await assert.rejects(() => client.get("/slow", { timeout: 100 }), TimeoutError);
    });
  });

  describe("response parsing", function () {
    it("should parse JSON response", async function () {
      fetchStub.resolves(mockResponse({ foo: "bar" }));

      const response = await client.get<{ foo: string }>("/json");

      assert.deepStrictEqual(response.data, { foo: "bar" });
    });

    it("should handle text response", async function () {
      const textResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/plain" }),
        json: () => Promise.reject(new Error("Not JSON")),
        text: () => Promise.resolve("Plain text"),
      } as Response;

      fetchStub.resolves(textResponse);

      const response = await client.get<string>("/text");

      assert.strictEqual(response.data, "Plain text");
    });

    it("should handle empty JSON response", async function () {
      const emptyResponse = {
        ok: true,
        status: 204,
        statusText: "No Content",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.reject(new SyntaxError("Unexpected end of JSON")),
        text: () => Promise.resolve(""),
      } as Response;

      fetchStub.resolves(emptyResponse);

      const response = await client.get("/empty");

      assert.strictEqual(response.status, 204);
      assert.strictEqual(response.data, undefined);
    });
  });

  describe("createHttpClient()", function () {
    it("should create client with config", function () {
      const testClient = createHttpClient({ baseUrl: "https://test.com" });

      fetchStub.resolves(mockResponse({}));
      testClient.get("/path");

      assert.ok(fetchStub.calledOnce);
    });
  });
});
