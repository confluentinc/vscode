import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { WebSocket } from "ws";
import * as storage from "../storage/utils";
import {
  adaptCompletionItems,
  convertToMultiLineRange,
  convertToSingleLinePosition,
  initializeLanguageClient,
} from "./languageClient";
import { getFlinkSQLLanguageServerOutputChannel } from "./logging";
import { WebsocketTransport } from "./websocketTransport";

describe("flinkSql/languageClient.ts position conversion functions", () => {
  let sandbox: sinon.SinonSandbox;
  let mockDocument: vscode.TextDocument;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockDocument = {
      getText: sandbox.stub().returns("line1\nline2\nline3\nline4"),
    } as unknown as vscode.TextDocument;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("convertToSingleLinePosition()", () => {
    it("should convert position on first line correctly", () => {
      const position = new vscode.Position(0, 3);
      const result = convertToSingleLinePosition(mockDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 3);
    });

    it("should handle position with character exceeding line length", () => {
      // Position beyond actual line length (line1 is 5 chars)
      const position = new vscode.Position(0, 10);
      const result = convertToSingleLinePosition(mockDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 10);
    });

    it("should convert position on second line correctly", () => {
      const position = new vscode.Position(1, 2);
      const result = convertToSingleLinePosition(mockDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 8); // "line1\n".length + 2 = 6 + 2 = 8
    });

    it("should convert position on last line correctly", () => {
      const position = new vscode.Position(3, 4);
      const result = convertToSingleLinePosition(mockDocument, position);

      // "line1\n".length + "line2\n".length + "line3\n".length + 4
      // = 6 + 6 + 6 + 4 = 22
      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 22);
    });

    it("should handle empty document correctly", () => {
      const emptyDocument = {
        getText: sandbox.stub().returns(""),
      } as unknown as vscode.TextDocument;
      const position = new vscode.Position(0, 0);
      const result = convertToSingleLinePosition(emptyDocument, position);

      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 0);
    });

    it("should handle document with different line lengths", () => {
      const complexDocument = {
        getText: sandbox.stub().returns("short\nverylongline\nx"),
      } as unknown as vscode.TextDocument;
      const position = new vscode.Position(2, 1);
      const result = convertToSingleLinePosition(complexDocument, position);

      // "short\n".length + "verylongline\n".length + 1
      // = 6 + 13 + 1 = 20
      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 20);
    });

    it("should handle document with consecutive newlines correctly", () => {
      const documentWithEmptyLines = {
        getText: sandbox.stub().returns("line1\n\n\nline4"),
      } as unknown as vscode.TextDocument;
      const position = new vscode.Position(3, 2);
      const result = convertToSingleLinePosition(documentWithEmptyLines, position);

      // "line1\n".length + "\n".length + "\n".length + 2
      // = 6 + 1 + 1 + 2 = 10
      assert.strictEqual(result.line, 0);
      assert.strictEqual(result.character, 10);
    });
  });

  describe("convertToMultiLineRange()", () => {
    it("should convert range on first line correctly", () => {
      const singleLineRange = new vscode.Range(0, 1, 0, 3);
      const result = convertToMultiLineRange(mockDocument, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 1);
      assert.strictEqual(result.end.line, 0);
      assert.strictEqual(result.end.character, 3);
    });

    it("should handle range with extreme offset values correctly", () => {
      // Position beyond the total document length
      const extremeRange = new vscode.Range(0, 500, 0, 600);
      const result = convertToMultiLineRange(mockDocument, extremeRange);

      // Should default to last position for both start and end
      assert.strictEqual(result.start.line, 3);
      assert.strictEqual(result.start.character, 5); // length of "line4"
      assert.strictEqual(result.end.line, 3);
      assert.strictEqual(result.end.character, 5); // length of "line4"
    });

    it("should convert range spanning multiple lines correctly", () => {
      // From line 0, char 3 to line 1, char 2
      const singleLineRange = new vscode.Range(0, 3, 0, 9);
      const result = convertToMultiLineRange(mockDocument, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 3);
      assert.strictEqual(result.end.line, 1);
      assert.strictEqual(result.end.character, 3);
    });

    it("should handle empty document correctly", () => {
      const emptyDocument = {
        getText: sandbox.stub().returns(""),
      } as unknown as vscode.TextDocument;
      const singleLineRange = new vscode.Range(0, 0, 0, 0);
      const result = convertToMultiLineRange(emptyDocument, singleLineRange);

      // With empty document, we should get default position
      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 0);
      assert.strictEqual(result.end.line, 0);
      assert.strictEqual(result.end.character, 0);
    });

    it("should handle document with different line lengths", () => {
      const complexDocument = {
        getText: sandbox.stub().returns("short\nverylongline\nx"),
      } as unknown as vscode.TextDocument;
      // Range from middle of first line to middle of last line
      const singleLineRange = new vscode.Range(0, 2, 0, 20);
      const result = convertToMultiLineRange(complexDocument, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 2);
      assert.strictEqual(result.end.line, 2);
      assert.strictEqual(result.end.character, 1);
    });

    it("should handle document with consecutive newlines correctly", () => {
      const documentWithEmptyLines = {
        getText: sandbox.stub().returns("line1\n\n\nline4"),
      } as unknown as vscode.TextDocument;
      // Range spanning from first line to fourth line
      const singleLineRange = new vscode.Range(0, 3, 0, 10);
      const result = convertToMultiLineRange(documentWithEmptyLines, singleLineRange);

      assert.strictEqual(result.start.line, 0);
      assert.strictEqual(result.start.character, 3);
      assert.strictEqual(result.end.line, 3);
      assert.strictEqual(result.end.character, 2);
    });
  });

  describe("Round-trip conversion", () => {
    it("should correctly round-trip from multi-line to single-line and back", () => {
      const originalPosition = new vscode.Position(1, 3);
      const singleLinePosition = convertToSingleLinePosition(mockDocument, originalPosition);
      // Verify single-line position converts correctly
      assert.strictEqual(singleLinePosition.line, 0);
      // "line1\n".length + 3 = 6 + 3 = 9
      assert.strictEqual(singleLinePosition.character, 9);

      const singleLineRange = new vscode.Range(
        singleLinePosition,
        singleLinePosition.translate(0, 2), // end position is 2 characters after start to simulate a longer completion
      );
      const multiLineRange = convertToMultiLineRange(mockDocument, singleLineRange);

      // Verify we got back our original position
      assert.strictEqual(multiLineRange.start.line, 1);
      assert.strictEqual(multiLineRange.start.character, 3);
    });

    it("should correctly handle document with trailing newline", () => {
      const documentWithTrailingNewline = {
        getText: sandbox.stub().returns("line1\nline2\nline3\nline4\n"),
      } as unknown as vscode.TextDocument;

      // A. Position at the end of line4 before the trailing newline
      const originalPosition = new vscode.Position(3, 5);
      const singleLinePosition = convertToSingleLinePosition(
        documentWithTrailingNewline,
        originalPosition,
      );
      assert.strictEqual(singleLinePosition.line, 0);
      // "line1\n".length + "line2\n".length + "line3\n".length + 5 = 6 + 6 + 6 + 5 = 23
      assert.strictEqual(singleLinePosition.character, 23);

      const singleLineRange = new vscode.Range(singleLinePosition, singleLinePosition);
      const multiLineRange = convertToMultiLineRange(documentWithTrailingNewline, singleLineRange);
      assert.strictEqual(multiLineRange.start.line, 3);
      assert.strictEqual(multiLineRange.start.character, 5);

      // B. Position at the very end of the document after the trailing newline
      const endPosition = new vscode.Position(4, 0);
      const endSingleLinePos = convertToSingleLinePosition(
        documentWithTrailingNewline,
        endPosition,
      );
      assert.strictEqual(endSingleLinePos.line, 0);
      // "line1\n".length + "line2\n".length + "line3\n".length + "line4\n".length = 6 + 6 + 6 + 6 = 24
      assert.strictEqual(endSingleLinePos.character, 24);

      const endSingleLineRange = new vscode.Range(endSingleLinePos, endSingleLinePos);
      const endMultiLineRange = convertToMultiLineRange(
        documentWithTrailingNewline,
        endSingleLineRange,
      );
      assert.strictEqual(endMultiLineRange.start.line, 4);
      assert.strictEqual(endMultiLineRange.start.character, 0);
    });
  });

  it("should correctly round-trip a range spanning multiple lines", () => {
    const originalRange = new vscode.Range(new vscode.Position(1, 2), new vscode.Position(3, 4));
    const singleLineStart = convertToSingleLinePosition(mockDocument, originalRange.start);
    const singleLineEnd = convertToSingleLinePosition(mockDocument, originalRange.end);
    const singleLineRange = new vscode.Range(singleLineStart, singleLineEnd);

    const resultRange = convertToMultiLineRange(mockDocument, singleLineRange);

    assert.deepStrictEqual(resultRange, originalRange);
  });

  it("should correctly round-trip edge case positions", () => {
    const text = mockDocument.getText();
    const lines = text.split("\n");
    const lastLineIndex = lines.length - 1;
    const lastLineLength = lines[lastLineIndex].length;

    const positionsToTest = [
      new vscode.Position(0, 0), // start of document
      new vscode.Position(1, 0), // start of a line
      new vscode.Position(lastLineIndex, lastLineLength), // end of document
    ];

    for (const originalPosition of positionsToTest) {
      const singleLinePosition = convertToSingleLinePosition(mockDocument, originalPosition);
      const singleLineRange = new vscode.Range(singleLinePosition, singleLinePosition);
      const resultRange = convertToMultiLineRange(mockDocument, singleLineRange);
      assert.deepStrictEqual(
        resultRange.start,
        originalPosition,
        `Failed for position ${originalPosition.line}:${originalPosition.character}`,
      );
    }
  });
});

describe("adaptCompletionItems", () => {
  it("should remove filterText if the completion does not have backticks", () => {
    const document = {
      getText: (range?: vscode.Range) => {
        if (range) {
          return "";
        }
        return "SELECT * FROM my_table";
      },
    } as vscode.TextDocument;

    const result = {
      items: [
        {
          label: "my_table",
          textEdit: {
            range: new vscode.Range(0, 14, 0, 22),
            newText: "my_table",
          },
          filterText: "`my_table`",
        },
      ],
    };

    const adaptedResult = adaptCompletionItems(result, document);
    const adaptedItem = adaptedResult.items[0];

    assert.strictEqual(adaptedItem.filterText, undefined, "filterText should be undefined");
  });

  it("should not change filterText if backticks are present", () => {
    const document = {
      getText: (range?: vscode.Range) => {
        if (range) {
          return "`my_table`";
        }
        return "SELECT * FROM `my_table`";
      },
    } as vscode.TextDocument;

    const result = {
      items: [
        {
          label: "my_table",
          textEdit: {
            range: new vscode.Range(0, 14, 0, 24),
            newText: "`my_table`",
          },
          filterText: "`my_table`",
        },
      ],
    };

    const adaptedResult = adaptCompletionItems(result, document);
    const adaptedItem = adaptedResult.items[0];

    assert.strictEqual(adaptedItem.filterText, "`my_table`", "filterText should not be changed");
  });
});

describe("flinkSql/languageClient.ts WebSocket connection and client initialization", () => {
  let sandbox: sinon.SinonSandbox;
  let mockWebSocket: sinon.SinonStubbedInstance<WebSocket>;
  let mockTransport: sinon.SinonStubbedInstance<WebsocketTransport>;
  let getSecretStorageStub: sinon.SinonStub;
  let clientStartStub: sinon.SinonStub;
  let createLanguageClientFromWebsocketStub: sinon.SinonStub;
  let onWebSocketDisconnect: sinon.SinonStub;
  const testUrl = "ws://test-url";
  const testToken = "test-token";

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Mock WebSocket
    mockWebSocket = sandbox.createStubInstance(WebSocket);
    sandbox.stub(global, "WebSocket").callsFake(() => mockWebSocket);

    // Mock secret storage
    getSecretStorageStub = sandbox.stub().returns({
      get: sandbox.stub().resolves(testToken),
    });
    sandbox.stub(storage, "getSecretStorage").returns(getSecretStorageStub());

    // Mock transport and client
    mockTransport = sandbox.createStubInstance(WebsocketTransport);
    clientStartStub = sandbox.stub().resolves();

    // Mock language client
    const mockLanguageClient = {
      start: clientStartStub,
      setTrace: sandbox.stub(),
    };
    sandbox
      .stub(require("vscode-languageclient/node"), "LanguageClient")
      .returns(mockLanguageClient);

    // Mock output channel
    sandbox.stub(getFlinkSQLLanguageServerOutputChannel);

    onWebSocketDisconnect = sandbox.stub();
    createLanguageClientFromWebsocketStub = sandbox.stub().resolves(mockLanguageClient);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("initializeLanguageClient()", () => {
    it("should return null when no access token is available", async () => {
      getSecretStorageStub().get.resolves(undefined);
      const result = await initializeLanguageClient(testUrl, onWebSocketDisconnect);
      assert.strictEqual(result, null);
    });

    it("should create WebSocket with authorization header", async () => {
      const initPromise = initializeLanguageClient(testUrl, onWebSocketDisconnect);

      // We don't await the promise because it should remain pending
      // until the WebSocket event handlers are triggered

      sinon.assert.calledOnce(global.WebSocket as sinon.SinonStub);
      sinon.assert.calledWith(
        global.WebSocket as sinon.SinonStub,
        testUrl,
        sinon.match({
          headers: {
            authorization: `Bearer ${testToken}`,
          },
        }),
      );
    });

    it("should handle 'OK' message and initialize language client", async () => {
      // Store the onmessage handler to call it manually
      let onMessageHandler: ((event: { data: string }) => Promise<void>) | null = null;

      // Override WebSocket mock to capture the onmessage handler
      (global.WebSocket as sinon.SinonStub).callsFake(() => {
        const ws = mockWebSocket;

        // Store the onmessage handler that will be set by initializeLanguageClient
        Object.defineProperty(ws, "onmessage", {
          set: function (handler) {
            onMessageHandler = handler;
          },
        });

        // Execute the onopen handler immediately
        setTimeout(() => {
          if (ws.onopen) {
            ws.onopen(new Event("open"));
          }
        }, 0);

        return ws;
      });

      // Mock createLanguageClientFromWebsocket function
      sandbox.stub(require("./languageClient"), "createLanguageClientFromWebsocket").resolves({
        client: "mock",
      });

      // Start initialization
      const clientPromise = initializeLanguageClient(testUrl, onWebSocketDisconnect);

      // Make sure onopen was called
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Make sure onMessageHandler was set
      assert.ok(onMessageHandler, "onmessage handler should be set");

      // Send the "OK" message to trigger client creation
      await onMessageHandler!({ data: "OK" });

      // Now the promise should resolve with the client
      const client = await clientPromise;
      assert.deepStrictEqual(client, { client: "mock" });
    });

    it("should handle WebSocket error", async () => {
      // Store the onerror handler to call it manually
      let onErrorHandler: ((error: Error) => void) | null = null;

      // Override WebSocket mock to capture the onerror handler
      (global.WebSocket as sinon.SinonStub).callsFake(() => {
        const ws = mockWebSocket;
        Object.defineProperty(ws, "onerror", {
          set: function (handler) {
            onErrorHandler = handler;
          },
        });
        return ws;
      });

      // Start initialization that should eventually be rejected
      const clientPromise = initializeLanguageClient(testUrl, onWebSocketDisconnect);

      // Make sure onErrorHandler was set
      assert.ok(onErrorHandler, "onerror handler should be set");

      // Trigger error
      const testError = new Error("Test WebSocket error");
      onErrorHandler!(testError);

      // Now the promise should reject
      await assert.rejects(clientPromise, Error);
    });

    it("should handle WebSocket close", async () => {
      // Store the onclose handler to call it manually
      let onCloseHandler: ((event: { code: number; reason: string }) => void) | null = null;

      // Override WebSocket mock to capture the onclose handler
      (global.WebSocket as sinon.SinonStub).callsFake(() => {
        const ws = mockWebSocket;
        Object.defineProperty(ws, "onclose", {
          set: function (handler) {
            onCloseHandler = handler;
          },
        });

        // Execute the onopen handler immediately
        setTimeout(() => {
          if (ws.onopen) {
            ws.onopen(new Event("open"));
          }
        }, 0);

        return ws;
      });

      // Start initialization
      initializeLanguageClient(testUrl, onWebSocketDisconnect);

      // Make sure onopen was called
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Make sure onCloseHandler was set
      assert.ok(onCloseHandler, "onclose handler should be set");

      // Trigger normal close (code 1000)
      onCloseHandler!({ code: 1000, reason: "Normal closure" });

      // Trigger abnormal close
      onCloseHandler!({ code: 1006, reason: "Abnormal closure" });
    });
  });

  describe("createLanguageClientFromWebsocket()", () => {
    it("should create language client with correct configuration", async () => {
      // Expose the function for testing
      const { createLanguageClientFromWebsocket } = require("./languageClient");

      const client = await createLanguageClientFromWebsocket(
        mockWebSocket,
        testUrl,
        onWebSocketDisconnect,
      );

      // Assert LanguageClient constructor was called with expected args
      sinon.assert.calledWith(
        require("vscode-languageclient/node").LanguageClient,
        "confluent.flinksqlLanguageServer",
        "ConfluentFlinkSQL",
        sinon.match.func,
        sinon.match({
          documentSelector: [
            { language: "flinksql" },
            { scheme: "untitled", language: "flinksql" },
            { pattern: "**/*.flink.sql" },
          ],
          progressOnInitialization: true,
          diagnosticCollectionName: "confluent.flinkSql",
        }),
      );

      // Assert client was started
      sinon.assert.calledOnce(clientStartStub);

      // Assert client object was returned
      assert.ok(client);
    });

    it("should handle error in language client start", async () => {
      // Expose the function for testing
      const { createLanguageClientFromWebsocket } = require("./languageClient");

      // Make client.start throw an error
      clientStartStub.rejects(new Error("Client start error"));

      await assert.rejects(
        createLanguageClientFromWebsocket(mockWebSocket, testUrl, onWebSocketDisconnect),
        /Client start error/,
      );
    });

    it("should create middleware that converts positions for completions", async () => {
      // Expose the function for testing
      const { createLanguageClientFromWebsocket } = require("./languageClient");

      let middleware: any;

      require("vscode-languageclient/node").LanguageClient.callsFake(
        (_id: string, _name: string, _serverOptions: any, options: any) => {
          middleware = options.middleware;
          return {
            start: clientStartStub,
            setTrace: sandbox.stub(),
          };
        },
      );

      await createLanguageClientFromWebsocket(mockWebSocket, testUrl, onWebSocketDisconnect);

      // Assert middleware was created
      assert.ok(middleware);
      assert.ok(middleware.sendRequest);

      // Test the middleware with a completion request
      const nextStub = sandbox.stub().resolves({ items: [] });
      const mockDocument = {
        getText: sandbox.stub().returns("line1\nline2"),
        uri: { toString: () => "file:///test.flink.sql" },
      };

      // Mock workspace.textDocuments
      sandbox.stub(vscode.workspace, "textDocuments").value([mockDocument]);

      const result = await middleware.sendRequest(
        { method: "textDocument/completion" },
        {
          textDocument: { uri: "file:///test.flink.sql" },
          position: { line: 1, character: 2 },
        },
        null,
        nextStub,
      );

      // Assert next was called with transformed position
      sinon.assert.calledWith(
        nextStub,
        { method: "textDocument/completion" },
        sinon.match({
          textDocument: { uri: "file:///test.flink.sql" },
          position: { line: 0, character: sinon.match.number },
        }),
        null,
      );
    });
  });
});
