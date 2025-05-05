import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { PARTICIPANT_ID } from "./constants";
import { chatHandler } from "./participant";

describe.only("Chat Participant Integration Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let mockStream: vscode.ChatResponseStream;
  let mockChatRequest: vscode.ChatRequest;
  let mockChatContext: vscode.ChatContext;
  let mockCancellationToken: vscode.CancellationToken;
  let mockLanguageModelChat: vscode.LanguageModelChat;
  let mockResponse: vscode.LanguageModelChatResponse;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockStream = {
      markdown: sandbox.stub() as any,
      progress: sandbox.stub() as any,
      reference: sandbox.stub() as any,
      button: sandbox.stub() as any,
      filetree: sandbox.stub() as any,
      anchor: sandbox.stub() as any,
      push: sandbox.stub() as any,
    };

    mockCancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: sandbox.stub() as any,
    };

    const chatRequest = {
      prompt: "Test prompt",
      references: [],
      command: undefined,
      participant: PARTICIPANT_ID,
      requestId: "test-request-id",
    };
    // Use type assertion to avoid read-only property error
    mockChatRequest = chatRequest as unknown as vscode.ChatRequest;
    (mockChatRequest as any).model = undefined;
    (mockChatRequest as any).toolInvocationToken = undefined;

    mockChatContext = {
      history: [],
    };

    mockResponse = {
      text: (async function* () {
        yield "Test response";
      })(),
      stream: (async function* () {
        yield new vscode.LanguageModelTextPart("Test response");
      })(),
    };

    mockLanguageModelChat = {
      name: "Test Model",
      id: "test-model",
      vendor: "copilot",
      family: "claude-3",
      version: "1.0",
      maxInputTokens: 4000,
      countTokens: sandbox.stub().resolves(100),
      sendRequest: sandbox.stub().resolves(mockResponse),
    };

    sandbox.stub(vscode.lm, "selectChatModels").resolves([mockLanguageModelChat]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("chatHandler", () => {
    it("should handle basic chat requests and return a result", async () => {
      const result = await chatHandler(
        mockChatRequest,
        mockChatContext,
        mockStream,
        mockCancellationToken,
      );

      assert.strictEqual((mockStream.markdown as any).called, true);
      assert.deepStrictEqual(result, { metadata: { toolsCalled: [] } });
    });

    it("should handle empty prompts gracefully", async () => {
      (mockChatRequest as any).prompt = "";

      const result = await chatHandler(
        mockChatRequest,
        mockChatContext,
        mockStream,
        mockCancellationToken,
      );

      assert.strictEqual(
        (mockStream.markdown as any).calledWith("Hmm... I don't know how to respond to that."),
        true,
      );
      assert.deepStrictEqual(result, {});
    });

    it("should handle errors in the response", async () => {
      const error = new Error("test error");

      (mockLanguageModelChat.sendRequest as any).rejects(error);

      const result = await chatHandler(
        mockChatRequest,
        mockChatContext,
        mockStream,
        mockCancellationToken,
      );

      assert.deepStrictEqual(result.errorDetails, { message: "test error" });
      assert.strictEqual(result.metadata?.error, true);
    });
  });
});
