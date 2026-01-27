import * as assert from "assert";
import sinon from "sinon";
import type { WebSocket } from "ws";
import {
  createAuthMessage,
  createTokenReplacer,
  DATA_PLANE_TOKEN_PLACEHOLDER,
  hasTokenPlaceholder,
  replaceTokenPlaceholder,
  sendAuthMessage,
} from "./flinkLspAuth";

describe("flinkLspAuth", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("DATA_PLANE_TOKEN_PLACEHOLDER", () => {
    it("should be the expected placeholder string", () => {
      assert.strictEqual(DATA_PLANE_TOKEN_PLACEHOLDER, "{{ ccloud.data_plane_token }}");
    });
  });

  describe("createAuthMessage", () => {
    it("should create auth message with correct structure", () => {
      const message = createAuthMessage("test-token", "env-123", "org-456");

      assert.deepStrictEqual(message, {
        Token: "test-token",
        EnvironmentId: "env-123",
        OrganizationId: "org-456",
      });
    });
  });

  describe("sendAuthMessage", () => {
    it("should send auth message to WebSocket", async () => {
      const sendStub = sandbox.stub().callsFake((_msg: string, callback: (err?: Error) => void) => {
        callback();
      });

      const mockWs = { send: sendStub } as unknown as WebSocket;
      const getToken = sandbox.stub().resolves("my-token");

      await sendAuthMessage(
        mockWs,
        {
          region: "us-west-2",
          provider: "aws",
          environmentId: "env-123",
          organizationId: "org-456",
        },
        getToken,
      );

      sinon.assert.calledOnce(sendStub);
      const sentMessage = JSON.parse(sendStub.firstCall.args[0]);
      assert.strictEqual(sentMessage.Token, "my-token");
      assert.strictEqual(sentMessage.EnvironmentId, "env-123");
      assert.strictEqual(sentMessage.OrganizationId, "org-456");
    });

    it("should throw error if token retrieval fails", async () => {
      const mockWs = { send: sandbox.stub() } as unknown as WebSocket;
      const getToken = sandbox.stub().resolves(null);

      await assert.rejects(
        sendAuthMessage(
          mockWs,
          {
            region: "us-west-2",
            provider: "aws",
            environmentId: "env-123",
            organizationId: "org-456",
          },
          getToken,
        ),
        /Failed to retrieve data plane token/,
      );
    });

    it("should throw error if WebSocket send fails", async () => {
      const sendError = new Error("Send failed");
      const sendStub = sandbox.stub().callsFake((_msg: string, callback: (err?: Error) => void) => {
        callback(sendError);
      });

      const mockWs = { send: sendStub } as unknown as WebSocket;
      const getToken = sandbox.stub().resolves("my-token");

      await assert.rejects(
        sendAuthMessage(
          mockWs,
          {
            region: "us-west-2",
            provider: "aws",
            environmentId: "env-123",
            organizationId: "org-456",
          },
          getToken,
        ),
        sendError,
      );
    });
  });

  describe("replaceTokenPlaceholder", () => {
    it("should replace placeholder with token", () => {
      const message = `{"AuthToken": "${DATA_PLANE_TOKEN_PLACEHOLDER}"}`;
      const result = replaceTokenPlaceholder(message, "my-actual-token");

      assert.strictEqual(result, '{"AuthToken": "my-actual-token"}');
    });

    it("should return original message if no placeholder", () => {
      const message = '{"AuthToken": "already-set"}';
      const result = replaceTokenPlaceholder(message, "my-actual-token");

      assert.strictEqual(result, message);
    });

    it("should replace placeholder in complex message", () => {
      const message = `{
        "settings": {
          "AuthToken": "${DATA_PLANE_TOKEN_PLACEHOLDER}",
          "Catalog": "my-catalog",
          "Database": "my-database"
        }
      }`;

      const result = replaceTokenPlaceholder(message, "real-token");
      assert.ok(result.includes('"AuthToken": "real-token"'));
      assert.ok(!result.includes(DATA_PLANE_TOKEN_PLACEHOLDER));
    });
  });

  describe("hasTokenPlaceholder", () => {
    it("should return true when placeholder is present", () => {
      const message = `{"AuthToken": "${DATA_PLANE_TOKEN_PLACEHOLDER}"}`;
      assert.strictEqual(hasTokenPlaceholder(message), true);
    });

    it("should return false when placeholder is not present", () => {
      const message = '{"AuthToken": "some-token"}';
      assert.strictEqual(hasTokenPlaceholder(message), false);
    });

    it("should return false for empty string", () => {
      assert.strictEqual(hasTokenPlaceholder(""), false);
    });
  });

  describe("createTokenReplacer", () => {
    it("should return function that replaces placeholders", async () => {
      const getToken = sandbox.stub().resolves("fresh-token");
      const replacer = createTokenReplacer(getToken);

      const message = `{"AuthToken": "${DATA_PLANE_TOKEN_PLACEHOLDER}"}`;
      const result = await replacer(message);

      assert.strictEqual(result, '{"AuthToken": "fresh-token"}');
      sinon.assert.calledOnce(getToken);
    });

    it("should not call getToken when no placeholder present", async () => {
      const getToken = sandbox.stub().resolves("fresh-token");
      const replacer = createTokenReplacer(getToken);

      const message = '{"AuthToken": "existing-token"}';
      const result = await replacer(message);

      assert.strictEqual(result, message);
      sinon.assert.notCalled(getToken);
    });

    it("should return original message if token is null", async () => {
      const getToken = sandbox.stub().resolves(null);
      const replacer = createTokenReplacer(getToken);

      const message = `{"AuthToken": "${DATA_PLANE_TOKEN_PLACEHOLDER}"}`;
      const result = await replacer(message);

      assert.strictEqual(result, message);
    });
  });
});
