import assert from "assert";
import "mocha";
import { MessageRouter } from "../ws/messageRouter";
import { Message, MessageType } from "../ws/messageTypes";
import { WebsocketManager } from "./websocketManager";

// tests over WebsocketManager

describe("WebsocketManager tests", () => {
  it("peerWorkspaceCount should be updated when WORKSPACE_COUNT_CHANGED message is received", async () => {
    // Arrange
    const messageRouter = MessageRouter.getInstance();
    const websocketManager = WebsocketManager.getInstance();

    const message: Message<MessageType.WORKSPACE_COUNT_CHANGED> = {
      headers: {
        message_type: MessageType.WORKSPACE_COUNT_CHANGED,
        originator: "sidecar",
        message_id: "1",
      },
      body: {
        current_workspace_count: 3, // inclusive of the current workspace
      },
    };

    // Act
    await messageRouter.deliver(message);

    // Assert
    assert.strictEqual(
      message.body.current_workspace_count - 1, // excluding the current workspace
      websocketManager.getPeerWorkspaceCount(),
    );
  });

  it("Sending when websocket is not open should throw an error", async () => {
    // Arrange
    const websocketManager = WebsocketManager.getInstance();
    const message: Message<MessageType.WORKSPACE_COUNT_CHANGED> = {
      headers: {
        message_type: MessageType.WORKSPACE_COUNT_CHANGED,
        originator: "sidecar",
        message_id: "1",
      },
      body: {
        current_workspace_count: 3, // inclusive of the current workspace
      },
    };

    // Act
    // Assert raises
    try {
      websocketManager.send(message);
      assert.fail("Expected an error to be thrown");
    } catch (e) {
      // should be type WebsocketClosedError
      assert.strictEqual((e as Error).name, "WebsocketClosedError");
    }
  });
});

describe("WebsocketManager.parseMessage tests", () => {
  it("parseMessage vs bad message structure tests", () => {
    const testCases = [
      // not an object at all
      "not an object",
      // no headers
      "{}",
      // no message_type or any other required header
      '{"headers":{}, "body":{}}',
      // unknown message type
      '{"headers":{"message_type":"BOGUS","originator":"sidecar","message_id":"1"}, "body":{}}',
      // no originator
      '{"headers":{"message_type":"WORKSPACE_COUNT_CHANGED","message_id":"1"}, "body":{}}',
      // bad originator: not "sidecar" or a workspace id
      '{"headers":{"message_type":"WORKSPACE_COUNT_CHANGED","originator":"bad","message_id":"1"}, "body":{}}',
      // No message body
      '{"headers":{"message_type":"WORKSPACE_COUNT_CHANGED","originator":"sidecar","message_id":"1"}}',
      // bad body for WORKSPACE_COUNT_CHANGED
      '{"headers":{"message_type":"WORKSPACE_COUNT_CHANGED","originator":"sidecar","message_id":"1"}, "body":{"foo":"bar"}}',
      // bad body for PROTOCOL_ERROR
      '{"headers":{"message_type":"PROTOCOL_ERROR","originator":"sidecar","message_id":"1"}, "body":{"foo":"bar"}}',
    ];

    for (const testCase of testCases) {
      assert.throws(() => {
        WebsocketManager.parseMessage(testCase);
      });
    }
  });

  it("parseMessage vs good message structure tests", () => {
    const testCases = [
      // WORKSPACE_COUNT_CHANGED
      {
        headers: {
          message_type: MessageType.WORKSPACE_COUNT_CHANGED,
          originator: "sidecar",
          message_id: "1",
        },
        body: {
          current_workspace_count: 3,
        },
      },

      // PROTOCOL_ERROR
      {
        headers: {
          message_type: MessageType.PROTOCOL_ERROR,
          originator: "sidecar",
          message_id: "1",
        },
        body: {
          error: "bad message",
        },
      },
    ];

    for (const testCase of testCases) {
      const message = WebsocketManager.parseMessage(JSON.stringify(testCase));
      assert.deepStrictEqual(message, testCase);
    }
  });
});
