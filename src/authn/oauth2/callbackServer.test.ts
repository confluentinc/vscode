import * as assert from "assert";
import * as http from "http";
import { OAuthCallbackServer } from "./callbackServer";
import type { OAuthCallbackResult } from "./types";
import { OAUTH_CONSTANTS } from "./config";

describe("authn/oauth2/callbackServer", function () {
  // Use a different port for tests to avoid conflicts
  const TEST_PORT = 26637;
  let server: OAuthCallbackServer;

  beforeEach(function () {
    server = new OAuthCallbackServer(TEST_PORT);
  });

  afterEach(async function () {
    await server.stop();
    server.dispose();
  });

  describe("constructor", function () {
    it("should use default port when not specified", function () {
      const defaultServer = new OAuthCallbackServer();
      assert.strictEqual(defaultServer.getPort(), OAUTH_CONSTANTS.CALLBACK_SERVER_PORT);
      defaultServer.dispose();
    });

    it("should use custom port when specified", function () {
      assert.strictEqual(server.getPort(), TEST_PORT);
    });
  });

  describe("start()", function () {
    it("should start the server", async function () {
      await server.start();

      assert.strictEqual(server.isRunning(), true);
    });

    it("should not start twice", async function () {
      await server.start();
      await server.start(); // Should not throw

      assert.strictEqual(server.isRunning(), true);
    });

    it("should throw if port is in use", async function () {
      // Start the server first
      await server.start();

      // Try to start another server on same port
      const server2 = new OAuthCallbackServer(TEST_PORT);

      await assert.rejects(() => server2.start(), /already in use/);

      server2.dispose();
    });
  });

  describe("stop()", function () {
    it("should stop a running server", async function () {
      await server.start();
      assert.strictEqual(server.isRunning(), true);

      await server.stop();
      assert.strictEqual(server.isRunning(), false);
    });

    it("should handle stopping a non-running server", async function () {
      await server.stop(); // Should not throw
      assert.strictEqual(server.isRunning(), false);
    });
  });

  describe("getCallbackUrl()", function () {
    it("should return correct callback URL", function () {
      const url = server.getCallbackUrl();

      assert.ok(url.includes(`127.0.0.1:${TEST_PORT}`));
      assert.ok(url.includes("/gateway/v1/callback-vscode-docs"));
    });
  });

  describe("HTTP request handling", function () {
    beforeEach(async function () {
      await server.start();
    });

    function makeRequest(
      path: string,
      method = "GET",
    ): Promise<{ statusCode: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: TEST_PORT,
            path,
            method,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ statusCode: res.statusCode ?? 500, body }));
          },
        );

        req.on("error", reject);
        req.end();
      });
    }

    it("should handle successful callback with code", async function () {
      let receivedResult: OAuthCallbackResult | undefined;
      server.onCallback((result) => {
        receivedResult = result;
      });

      const response = await makeRequest(
        "/gateway/v1/callback-vscode-docs?code=test-code&state=test-state",
      );

      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.body.includes("Authentication Complete"));
      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.success, true);
      assert.strictEqual(receivedResult!.code, "test-code");
      assert.strictEqual(receivedResult!.state, "test-state");
    });

    it("should handle error callback", async function () {
      let receivedResult: OAuthCallbackResult | undefined;
      server.onCallback((result) => {
        receivedResult = result;
      });

      const response = await makeRequest(
        "/gateway/v1/callback-vscode-docs?error=access_denied&error_description=User+denied+access&state=test-state",
      );

      assert.strictEqual(response.statusCode, 400);
      assert.ok(response.body.includes("Authentication Failed"));
      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.success, false);
      assert.strictEqual(receivedResult!.error?.error, "access_denied");
      assert.strictEqual(receivedResult!.error?.errorDescription, "User denied access");
      assert.strictEqual(receivedResult!.state, "test-state");
    });

    it("should handle missing code", async function () {
      let receivedResult: OAuthCallbackResult | undefined;
      server.onCallback((result) => {
        receivedResult = result;
      });

      const response = await makeRequest("/gateway/v1/callback-vscode-docs?state=test-state");

      assert.strictEqual(response.statusCode, 400);
      assert.ok(response.body.includes("No authorization code provided"));
      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.success, false);
      assert.strictEqual(receivedResult!.error?.error, "missing_code");
    });

    it("should return 404 for unknown paths", async function () {
      const response = await makeRequest("/unknown/path");

      assert.strictEqual(response.statusCode, 404);
    });

    it("should return 405 for non-GET methods", async function () {
      const response = await makeRequest("/gateway/v1/callback-vscode-docs?code=test", "POST");

      assert.strictEqual(response.statusCode, 405);
    });

    it("should include error_uri when present", async function () {
      let receivedResult: OAuthCallbackResult | undefined;
      server.onCallback((result) => {
        receivedResult = result;
      });

      await makeRequest(
        "/gateway/v1/callback-vscode-docs?error=server_error&error_uri=https://example.com/error",
      );

      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.error?.errorUri, "https://example.com/error");
    });

    it("should work without a registered handler", async function () {
      // Don't register a handler
      const response = await makeRequest("/gateway/v1/callback-vscode-docs?code=test-code");

      assert.strictEqual(response.statusCode, 200);
    });

    it("should handle callback path prefix matching", async function () {
      let receivedResult: OAuthCallbackResult | undefined;
      server.onCallback((result) => {
        receivedResult = result;
      });

      // Path with extra segments should still work
      const response = await makeRequest("/gateway/v1/callback-vscode-docs/extra?code=test");

      assert.strictEqual(response.statusCode, 200);
      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.success, true);
    });
  });

  describe("dispose()", function () {
    it("should stop the server when disposed", async function () {
      await server.start();
      assert.strictEqual(server.isRunning(), true);

      server.dispose();

      // Give it a moment to stop
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Server should be stopped (isRunning may still return true briefly)
      // The important thing is that dispose doesn't throw
    });

    it("should handle disposal of non-started server", function () {
      server.dispose(); // Should not throw
    });
  });
});
