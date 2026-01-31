import * as assert from "assert";
import sinon from "sinon";
import { TokenManager } from "../authn/oauth2/tokenManager";
import {
  buildDirectFlinkLspUrl,
  createFlinkLanguageServiceClient,
  FlinkLspConnectionState,
} from "./flinkLanguageServiceClient";

describe("flinkLanguageServiceClient", () => {
  let sandbox: sinon.SinonSandbox;
  let tokenManagerStub: sinon.SinonStubbedInstance<TokenManager>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    tokenManagerStub = sandbox.createStubInstance(TokenManager);
    sandbox.stub(TokenManager, "getInstance").returns(tokenManagerStub);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("createFlinkLanguageServiceClient", () => {
    it("should create a client with default configuration", () => {
      const client = createFlinkLanguageServiceClient();

      assert.ok(client);
      assert.strictEqual(client.getState(), FlinkLspConnectionState.DISCONNECTED);
      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getWebSocket(), null);
    });

    it("should create a client with custom token provider", () => {
      const customTokenProvider = sandbox.stub().resolves("custom-token");
      const client = createFlinkLanguageServiceClient({
        getToken: customTokenProvider,
      });

      assert.ok(client);
      assert.strictEqual(client.getState(), FlinkLspConnectionState.DISCONNECTED);
    });

    it("should create a client with custom timeout", () => {
      const client = createFlinkLanguageServiceClient({
        connectionTimeout: 5000,
      });

      assert.ok(client);
      // Timeout is internal but the client should be created
      assert.strictEqual(client.getState(), FlinkLspConnectionState.DISCONNECTED);
    });
  });

  describe("client state management", () => {
    it("should start in disconnected state", () => {
      const client = createFlinkLanguageServiceClient();
      assert.strictEqual(client.getState(), FlinkLspConnectionState.DISCONNECTED);
    });

    it("should return false for isConnected when not connected", () => {
      const client = createFlinkLanguageServiceClient();
      assert.strictEqual(client.isConnected(), false);
    });

    it("should return null for getWebSocket when not connected", () => {
      const client = createFlinkLanguageServiceClient();
      assert.strictEqual(client.getWebSocket(), null);
    });
  });

  describe("dispose", () => {
    it("should dispose without error", () => {
      const client = createFlinkLanguageServiceClient();
      assert.doesNotThrow(() => client.dispose());
    });

    it("should set state to disconnected after dispose", () => {
      const client = createFlinkLanguageServiceClient();
      client.dispose();
      assert.strictEqual(client.getState(), FlinkLspConnectionState.DISCONNECTED);
    });
  });

  describe("disconnect", () => {
    it("should disconnect without error when not connected", () => {
      const client = createFlinkLanguageServiceClient();
      assert.doesNotThrow(() => client.disconnect());
    });

    it("should set state to disconnected after disconnect", () => {
      const client = createFlinkLanguageServiceClient();
      client.disconnect();
      assert.strictEqual(client.getState(), FlinkLspConnectionState.DISCONNECTED);
    });
  });

  describe("event handlers", () => {
    it("should accept onStateChange callback", () => {
      const onStateChange = sandbox.stub();
      const client = createFlinkLanguageServiceClient({}, { onStateChange });

      // State change callback is registered but won't be called until connection
      assert.ok(client);
    });

    it("should accept onMessage callback", () => {
      const onMessage = sandbox.stub();
      const client = createFlinkLanguageServiceClient({}, { onMessage });

      assert.ok(client);
    });

    it("should accept onError callback", () => {
      const onError = sandbox.stub();
      const client = createFlinkLanguageServiceClient({}, { onError });

      assert.ok(client);
    });

    it("should accept onClose callback", () => {
      const onClose = sandbox.stub();
      const client = createFlinkLanguageServiceClient({}, { onClose });

      assert.ok(client);
    });
  });

  describe("buildDirectFlinkLspUrl", () => {
    it("should build public URL for given region and provider", () => {
      const url = buildDirectFlinkLspUrl("env-123", "us-west-2", "aws");
      assert.strictEqual(url, "wss://flinkpls.us-west-2.aws.confluent.cloud/lsp");
    });

    it("should build URL for GCP", () => {
      const url = buildDirectFlinkLspUrl("env-123", "europe-west1", "gcp");
      assert.strictEqual(url, "wss://flinkpls.europe-west1.gcp.confluent.cloud/lsp");
    });

    it("should build URL for Azure", () => {
      const url = buildDirectFlinkLspUrl("env-123", "eastus", "azure");
      assert.strictEqual(url, "wss://flinkpls.eastus.azure.confluent.cloud/lsp");
    });
  });
});
