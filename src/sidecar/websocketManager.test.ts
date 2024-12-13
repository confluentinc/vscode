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
