import * as assert from "assert";
import * as sinon from "sinon";
import { Message, RequestMessage } from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Logger } from "../logging";
import { WebsocketTransport } from "./websocketTransport";

describe("WebsocketTransport", () => {
  let sandbox: sinon.SinonSandbox;
  let mockSocket: any;
  let loggerStub: any;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create a mock WebSocket
    mockSocket = {
      on: sandbox.stub(),
      send: sandbox.stub(),
      close: sandbox.stub(),
      readyState: WebSocket.OPEN,
    };

    // Stub the logger to avoid real logging during tests
    loggerStub = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    sandbox.stub(Logger.prototype, "debug").callsFake(loggerStub.debug);
    sandbox.stub(Logger.prototype, "error").callsFake(loggerStub.error);
    sandbox.stub(Logger.prototype, "info").callsFake(loggerStub.info);
    sandbox.stub(Logger.prototype, "warn").callsFake(loggerStub.warn);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("WebsocketMessageReader", () => {
    it("should register event listeners on WebSocket constructor", () => {
      // Creating a transport will create a reader which registers listeners
      new WebsocketTransport(mockSocket);

      // The reader should register message, close, and error listeners
      sinon.assert.calledWith(mockSocket.on, "message", sinon.match.func);
      sinon.assert.calledWith(mockSocket.on, "close", sinon.match.func);
      sinon.assert.calledWith(mockSocket.on, "error", sinon.match.func);
    });

    it("should parse messages and emit them", () => {
      const transport = new WebsocketTransport(mockSocket);
      const callback = sandbox.stub();

      // Register a message listener
      transport.reader.listen(callback);

      // Get the message handler that was registered
      const messageHandler = mockSocket.on.args.find((args: any) => args[0] === "message")?.[1];
      assert.ok(messageHandler, "Message handler not registered");

      // Simulate receiving a message
      const testMessage = { jsonrpc: "2.0", method: "test", params: {} };
      messageHandler(JSON.stringify(testMessage));

      // Verify the callback was called with the parsed message
      sinon.assert.calledOnce(callback);
      sinon.assert.calledWithMatch(callback, testMessage);
    });

    it("should handle buffer data", () => {
      const transport = new WebsocketTransport(mockSocket);
      const callback = sandbox.stub();

      // Register a message listener
      transport.reader.listen(callback);

      // Get the message handler
      const messageHandler = mockSocket.on.args.find((args: any) => args[0] === "message")?.[1];
      assert.ok(messageHandler, "Message handler not registered");

      // Simulate receiving a message as Buffer
      const testMessage = { jsonrpc: "2.0", method: "test", params: {} };
      const messageBuffer = Buffer.from(JSON.stringify(testMessage), "utf8");
      messageHandler(messageBuffer);

      // Verify the callback was called with the parsed message
      sinon.assert.calledOnce(callback);
      sinon.assert.calledWithMatch(callback, testMessage);
    });

    it("should emit errors on parse failure", () => {
      const transport = new WebsocketTransport(mockSocket);
      const errorHandler = sandbox.stub();

      // Register an error listener
      transport.reader.onError(errorHandler);

      // Get the message handler
      const messageHandler = mockSocket.on.args.find((args: any) => args[0] === "message")?.[1];
      assert.ok(messageHandler, "Message handler not registered");

      // Simulate receiving invalid JSON
      messageHandler("this is not valid JSON");

      // Verify an error was emitted
      sinon.assert.calledOnce(errorHandler);
      sinon.assert.called(loggerStub.error);
    });

    it("should emit close event when socket closes", () => {
      const transport = new WebsocketTransport(mockSocket);
      const closeHandler = sandbox.stub();

      // Register a close listener
      transport.reader.onClose(closeHandler);

      // Get the close handler
      const socketCloseHandler = mockSocket.on.args.find((args: any) => args[0] === "close")?.[1];
      assert.ok(socketCloseHandler, "Close handler not registered");

      // Simulate socket close
      socketCloseHandler();

      // Verify close was emitted
      sinon.assert.calledOnce(closeHandler);
      sinon.assert.called(loggerStub.debug);
    });
  });

  describe("WebsocketMessageWriter", () => {
    it("should send messages as JSON strings", async () => {
      const transport = new WebsocketTransport(mockSocket);

      // Configure the send stub to call its callback with no error
      mockSocket.send.callsFake((data: any, callback: () => void) => {
        if (callback) callback();
      });

      // Create a test message
      const message: Message = {
        jsonrpc: "2.0",
        id: 1,
        method: "testMethod",
        params: { test: true },
      } as Message;

      // Send the message
      await transport.writer.write(message);

      // Verify the message was sent correctly
      sinon.assert.calledOnce(mockSocket.send);
      sinon.assert.calledWithMatch(mockSocket.send, JSON.stringify(message), sinon.match.func);
    });

    it("should reject the promise if send fails", async () => {
      const transport = new WebsocketTransport(mockSocket);
      const testError = new Error("Send failed");

      // Configure the send stub to call its callback with an error
      mockSocket.send.callsFake((data: string | Buffer, callback: (err?: Error) => void) => {
        if (callback) callback(testError);
      });
      // Create a test message
      const message: RequestMessage = {
        jsonrpc: "2.0",
        id: 1,
        method: "testMethod",
        params: {},
      };

      // Send the message and expect rejection
      await assert.rejects(async () => {
        await transport.writer.write(message);
      });

      // Verify that send was called
      sinon.assert.calledOnce(mockSocket.send);
      sinon.assert.called(loggerStub.error);
    });

    it("should not attempt to send if socket is closed", async () => {
      const transport = new WebsocketTransport(mockSocket);

      // Set readyState to CLOSED
      mockSocket.readyState = WebSocket.CLOSED;

      // Create a test message
      const message: RequestMessage = {
        jsonrpc: "2.0",
        method: "testMethod",
        id: 1,
        params: {},
      };

      // Send the message
      await transport.writer.write(message);

      // Verify that send was not called
      sinon.assert.notCalled(mockSocket.send);
      sinon.assert.called(loggerStub.warn);
    });

    it("should close the socket gracefully on end()", async () => {
      const transport = new WebsocketTransport(mockSocket);

      // Need to get the writer instance to call end directly
      const writer = transport.writer as any;
      await writer.end();

      // Verify that socket.close was called with normal closure code
      sinon.assert.calledOnce(mockSocket.close);
      sinon.assert.calledWithMatch(mockSocket.close, 1000, sinon.match.string);
    });
  });

  describe("WebsocketTransport class", () => {
    it("should create reader and writer on construction", () => {
      const transport = new WebsocketTransport(mockSocket);

      assert.ok(transport.reader, "Reader should be created");
      assert.ok(transport.writer, "Writer should be created");
    });

    it.only("should dispose reader, writer and close socket on dispose", async () => {
      const transport = new WebsocketTransport(mockSocket);

      // Create spies for reader and writer dispose methods
      const readerDisposeSpy = sandbox.spy(transport.reader, "dispose");
      const writerDisposeSpy = sandbox.spy(transport.writer, "dispose");

      // Dispose the transport
      await transport.dispose();

      // Verify that dispose was called on reader and writer
      sinon.assert.calledOnce(readerDisposeSpy);
      sinon.assert.calledOnce(writerDisposeSpy);

      // Verify socket.close was called
      sinon.assert.called(mockSocket.close);
    });

    it("should attempt to end the writer before disposing", () => {
      const transport = new WebsocketTransport(mockSocket);

      // Need to get the writer instance to spy on end
      const writer = transport.writer as any;
      const writerEndSpy = sandbox.stub(writer, "end").resolves();

      // Dispose the transport
      transport.dispose();

      // Verify that end was called on writer
      sinon.assert.calledOnce(writerEndSpy);
    });
  });
});
