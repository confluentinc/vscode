import * as assert from "assert";
import sinon from "sinon";
import type * as vscode from "vscode";
import { PKCEStateManager } from "./pkceStateManager";
import { CCloudEnvironment } from "./config";

describe("authn/oauth2/pkceStateManager", function () {
  let mockSecretStorage: sinon.SinonStubbedInstance<vscode.SecretStorage>;
  let pkceStateManager: PKCEStateManager;
  let storageData: Map<string, string>;

  beforeEach(function () {
    // Reset singleton
    PKCEStateManager.resetInstance();

    // Create mock storage
    storageData = new Map();
    mockSecretStorage = {
      get: sinon.stub().callsFake(async (key: string) => storageData.get(key)),
      store: sinon.stub().callsFake(async (key: string, value: string) => {
        storageData.set(key, value);
      }),
      delete: sinon.stub().callsFake(async (key: string) => {
        storageData.delete(key);
      }),
      onDidChange: sinon.stub().returns({ dispose: () => {} }),
    } as unknown as sinon.SinonStubbedInstance<vscode.SecretStorage>;

    pkceStateManager = PKCEStateManager.getInstance();
  });

  afterEach(function () {
    sinon.restore();
    PKCEStateManager.resetInstance();
  });

  describe("getInstance", function () {
    it("should return the same instance", function () {
      const instance1 = PKCEStateManager.getInstance();
      const instance2 = PKCEStateManager.getInstance();
      assert.strictEqual(instance1, instance2);
    });
  });

  describe("initialize", function () {
    it("should initialize with secret storage", async function () {
      await pkceStateManager.initialize(mockSecretStorage);
      // Should not throw and should be ready to use
      const state = await pkceStateManager.getState();
      assert.strictEqual(state, null); // No state initially
    });

    it("should load existing state from storage", async function () {
      const existingState = {
        pkce: {
          codeVerifier: "test-verifier",
          codeChallenge: "test-challenge",
          codeChallengeMethod: "S256" as const,
          state: "test-state",
        },
        signInUri: "https://login.confluent.io/oauth/authorize?...",
        createdAt: new Date().toISOString(),
        environment: CCloudEnvironment.PRODUCTION,
      };
      storageData.set("confluent.oauth.pkce", JSON.stringify(existingState));

      await pkceStateManager.initialize(mockSecretStorage);
      const state = await pkceStateManager.getState();

      assert.ok(state);
      assert.strictEqual(state.pkce.codeVerifier, "test-verifier");
      assert.strictEqual(state.environment, CCloudEnvironment.PRODUCTION);
    });

    it("should clear invalid stored state", async function () {
      storageData.set("confluent.oauth.pkce", "invalid json");

      await pkceStateManager.initialize(mockSecretStorage);
      const state = await pkceStateManager.getState();

      assert.strictEqual(state, null);
      assert.ok(mockSecretStorage.delete.calledWith("confluent.oauth.pkce"));
    });
  });

  describe("getOrCreateSignInUri", function () {
    beforeEach(async function () {
      await pkceStateManager.initialize(mockSecretStorage);
    });

    it("should create a new sign-in URI", async function () {
      const signInUri = await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);

      assert.ok(signInUri);
      assert.ok(signInUri.startsWith("https://login.confluent.io/oauth/authorize?"));
      assert.ok(signInUri.includes("response_type=code"));
      assert.ok(signInUri.includes("code_challenge="));
      assert.ok(signInUri.includes("code_challenge_method=S256"));
      assert.ok(signInUri.includes("state="));
    });

    it("should store PKCE state in secret storage", async function () {
      await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);

      assert.ok(mockSecretStorage.store.called);
      const storedData = storageData.get("confluent.oauth.pkce");
      assert.ok(storedData);

      const parsed = JSON.parse(storedData);
      assert.ok(parsed.pkce.codeVerifier);
      assert.ok(parsed.pkce.codeChallenge);
      assert.ok(parsed.pkce.state);
      assert.strictEqual(parsed.environment, CCloudEnvironment.PRODUCTION);
    });

    it("should reuse existing valid state", async function () {
      const uri1 = await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);
      const uri2 = await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);

      assert.strictEqual(uri1, uri2);
    });

    it("should create new state when environment changes", async function () {
      const uri1 = await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);
      const uri2 = await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.STAGING);

      assert.notStrictEqual(uri1, uri2);
      assert.ok(uri2.includes("login-stag.confluent-dev.io"));
    });

    it("should create new state when forceNew is true", async function () {
      const uri1 = await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);
      const uri2 = await pkceStateManager.getOrCreateSignInUri(
        CCloudEnvironment.PRODUCTION,
        undefined,
        true,
      );

      // Different state parameters mean different URIs
      const state1 = new URL(uri1).searchParams.get("state");
      const state2 = new URL(uri2).searchParams.get("state");
      assert.notStrictEqual(state1, state2);
    });
  });

  describe("getCodeVerifier", function () {
    beforeEach(async function () {
      await pkceStateManager.initialize(mockSecretStorage);
    });

    it("should return code verifier when state exists", async function () {
      await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);
      const verifier = await pkceStateManager.getCodeVerifier();

      assert.ok(verifier);
      assert.ok(verifier.length > 0);
    });

    it("should return null when no state exists", async function () {
      const verifier = await pkceStateManager.getCodeVerifier();
      assert.strictEqual(verifier, null);
    });
  });

  describe("getStateParam", function () {
    beforeEach(async function () {
      await pkceStateManager.initialize(mockSecretStorage);
    });

    it("should return state param when state exists", async function () {
      await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);
      const stateParam = await pkceStateManager.getStateParam();

      assert.ok(stateParam);
      assert.ok(stateParam.length > 0);
    });

    it("should return null when no state exists", async function () {
      const stateParam = await pkceStateManager.getStateParam();
      assert.strictEqual(stateParam, null);
    });
  });

  describe("clearState", function () {
    beforeEach(async function () {
      await pkceStateManager.initialize(mockSecretStorage);
    });

    it("should clear stored state", async function () {
      await pkceStateManager.getOrCreateSignInUri(CCloudEnvironment.PRODUCTION);

      // Verify state exists
      let state = await pkceStateManager.getState();
      assert.ok(state);

      // Clear state
      await pkceStateManager.clearState();

      // Verify state is gone
      state = await pkceStateManager.getState();
      assert.strictEqual(state, null);
      assert.ok(mockSecretStorage.delete.calledWith("confluent.oauth.pkce"));
    });
  });

  describe("state expiration", function () {
    beforeEach(async function () {
      await pkceStateManager.initialize(mockSecretStorage);
    });

    it("should consider expired state as invalid", async function () {
      // Create state that is 15 minutes old (beyond 10 minute max)
      const expiredState = {
        pkce: {
          codeVerifier: "test-verifier",
          codeChallenge: "test-challenge",
          codeChallengeMethod: "S256" as const,
          state: "test-state",
        },
        signInUri: "https://login.confluent.io/oauth/authorize?...",
        createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        environment: CCloudEnvironment.PRODUCTION,
      };
      storageData.set("confluent.oauth.pkce", JSON.stringify(expiredState));

      // Re-initialize to pick up the stored state
      PKCEStateManager.resetInstance();
      pkceStateManager = PKCEStateManager.getInstance();
      await pkceStateManager.initialize(mockSecretStorage);

      // getState should return null for expired state
      const state = await pkceStateManager.getState();
      assert.strictEqual(state, null);
    });
  });
});
