import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { OAuthUriHandler, createCallbackUri, createErrorCallbackUri } from "./uriHandler";
import type { OAuthCallbackResult } from "./types";
import { CALLBACK_URIS } from "./config";

describe("authn/oauth2/uriHandler", function () {
  let handler: OAuthUriHandler;
  let mockContext: vscode.ExtensionContext;

  beforeEach(function () {
    handler = new OAuthUriHandler();

    // Create a mock extension context
    mockContext = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
  });

  afterEach(function () {
    handler.dispose();
    sinon.restore();
  });

  describe("constructor", function () {
    it("should create handler not initially active", function () {
      assert.strictEqual(handler.isActive(), false);
    });
  });

  describe("activate()", function () {
    it("should register handler with VS Code", function () {
      const registerStub = sinon.stub(vscode.window, "registerUriHandler").returns({
        dispose: sinon.stub(),
      } as unknown as vscode.Disposable);

      handler.activate(mockContext);

      assert.ok(registerStub.calledOnce);
      assert.strictEqual(handler.isActive(), true);
    });

    it("should not register twice", function () {
      const registerStub = sinon.stub(vscode.window, "registerUriHandler").returns({
        dispose: sinon.stub(),
      } as unknown as vscode.Disposable);

      handler.activate(mockContext);
      handler.activate(mockContext);

      assert.strictEqual(registerStub.callCount, 1);
    });

    it("should add disposable to context subscriptions", function () {
      const disposable = { dispose: sinon.stub() };
      sinon
        .stub(vscode.window, "registerUriHandler")
        .returns(disposable as unknown as vscode.Disposable);

      handler.activate(mockContext);

      assert.strictEqual(mockContext.subscriptions.length, 1);
      assert.strictEqual(mockContext.subscriptions[0], disposable);
    });
  });

  describe("handleUri()", function () {
    beforeEach(function () {
      sinon.stub(vscode.window, "registerUriHandler").returns({
        dispose: sinon.stub(),
      } as unknown as vscode.Disposable);
      handler.activate(mockContext);
    });

    it("should parse successful callback", function () {
      let receivedResult: OAuthCallbackResult | undefined;
      handler.onCallback((result) => {
        receivedResult = result;
      });

      const uri = vscode.Uri.parse(
        "vscode://confluentinc.vscode-confluent/authCallback?code=test-code&state=test-state",
      );
      handler.handleUri(uri);

      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.success, true);
      assert.strictEqual(receivedResult!.code, "test-code");
      assert.strictEqual(receivedResult!.state, "test-state");
    });

    it("should parse error callback", function () {
      let receivedResult: OAuthCallbackResult | undefined;
      handler.onCallback((result) => {
        receivedResult = result;
      });

      const uri = vscode.Uri.parse(
        "vscode://confluentinc.vscode-confluent/authCallback?error=access_denied&error_description=User+denied",
      );
      handler.handleUri(uri);

      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.success, false);
      assert.strictEqual(receivedResult!.error?.error, "access_denied");
      assert.strictEqual(receivedResult!.error?.errorDescription, "User denied");
    });

    it("should handle missing code as error", function () {
      let receivedResult: OAuthCallbackResult | undefined;
      handler.onCallback((result) => {
        receivedResult = result;
      });

      const uri = vscode.Uri.parse(
        "vscode://confluentinc.vscode-confluent/authCallback?state=test-state",
      );
      handler.handleUri(uri);

      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.success, false);
      assert.strictEqual(receivedResult!.error?.error, "missing_code");
    });

    it("should ignore non-callback URIs", function () {
      let receivedResult: OAuthCallbackResult | undefined;
      handler.onCallback((result) => {
        receivedResult = result;
      });

      const uri = vscode.Uri.parse("vscode://confluentinc.vscode-confluent/other?code=test");
      handler.handleUri(uri);

      assert.strictEqual(receivedResult, undefined);
    });

    it("should include error_uri when present", function () {
      let receivedResult: OAuthCallbackResult | undefined;
      handler.onCallback((result) => {
        receivedResult = result;
      });

      const uri = vscode.Uri.parse(
        "vscode://confluentinc.vscode-confluent/authCallback?error=server_error&error_uri=https://example.com/error",
      );
      handler.handleUri(uri);

      assert.ok(receivedResult);
      assert.strictEqual(receivedResult!.error?.errorUri, "https://example.com/error");
    });

    it("should work without a registered handler", function () {
      const uri = vscode.Uri.parse(
        "vscode://confluentinc.vscode-confluent/authCallback?code=test-code",
      );

      // Should not throw
      handler.handleUri(uri);
    });

    it("should handle handler errors gracefully", function () {
      handler.onCallback(() => {
        throw new Error("Handler error");
      });

      const uri = vscode.Uri.parse(
        "vscode://confluentinc.vscode-confluent/authCallback?code=test-code",
      );

      // Should not throw
      handler.handleUri(uri);
    });
  });

  describe("getCallbackUri()", function () {
    it("should return VS Code callback URI", function () {
      const uri = handler.getCallbackUri();

      assert.strictEqual(uri, CALLBACK_URIS.VSCODE_URI);
      assert.ok(uri.includes("vscode://"));
      assert.ok(uri.includes("authCallback"));
    });
  });

  describe("dispose()", function () {
    it("should clean up resources", function () {
      const disposeStub = sinon.stub();
      sinon.stub(vscode.window, "registerUriHandler").returns({
        dispose: disposeStub,
      } as unknown as vscode.Disposable);

      handler.activate(mockContext);
      assert.strictEqual(handler.isActive(), true);

      handler.dispose();

      assert.ok(disposeStub.calledOnce);
      assert.strictEqual(handler.isActive(), false);
    });

    it("should handle disposal without activation", function () {
      handler.dispose(); // Should not throw
      assert.strictEqual(handler.isActive(), false);
    });
  });

  describe("createCallbackUri()", function () {
    it("should create URI with code", function () {
      const uri = createCallbackUri("test-code");

      // Check query params using URLSearchParams
      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get("code"), "test-code");
      assert.ok(uri.path === "/authCallback");
    });

    it("should include state when provided", function () {
      const uri = createCallbackUri("test-code", "test-state");

      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get("code"), "test-code");
      assert.strictEqual(params.get("state"), "test-state");
    });

    it("should create valid VS Code URI", function () {
      const uri = createCallbackUri("code");

      assert.strictEqual(uri.scheme, "vscode");
      assert.strictEqual(uri.authority, "confluentinc.vscode-confluent");
    });
  });

  describe("createErrorCallbackUri()", function () {
    it("should create URI with error", function () {
      const uri = createErrorCallbackUri("access_denied");

      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get("error"), "access_denied");
      assert.ok(uri.path === "/authCallback");
    });

    it("should include error description when provided", function () {
      const uri = createErrorCallbackUri("access_denied", "User denied access");

      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get("error"), "access_denied");
      assert.strictEqual(params.get("error_description"), "User denied access");
    });

    it("should include state when provided", function () {
      const uri = createErrorCallbackUri("error", undefined, "test-state");

      const params = new URLSearchParams(uri.query);
      assert.strictEqual(params.get("state"), "test-state");
    });

    it("should create valid VS Code URI", function () {
      const uri = createErrorCallbackUri("error");

      assert.strictEqual(uri.scheme, "vscode");
      assert.strictEqual(uri.authority, "confluentinc.vscode-confluent");
    });
  });
});
