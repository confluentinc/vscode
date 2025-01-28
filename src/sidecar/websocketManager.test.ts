import assert from "assert";
import * as sinon from "sinon";
import { getSidecar } from ".";
import { GOOD_CCLOUD_CONNECTION_EVENT_MESSAGE } from "../../tests/unit/testResources/websocketMessages";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { Message, MessageType, newMessageHeaders, WorkspacesChangedBody } from "../ws/messageTypes";
import { constructMessageRouter, WebsocketManager } from "./websocketManager";

// tests over WebsocketManager

describe("WebsocketManager peerWorkspaceCount tests", () => {
  it("peerWorkspaceCount should be updated when WORKSPACE_COUNT_CHANGED message is received", async () => {
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
    await websocketManager.deliverToCallbacks(message);

    // Assert
    assert.strictEqual(
      message.body.current_workspace_count - 1, // excluding the current workspace
      websocketManager.getPeerWorkspaceCount(),
    );
  });
});

describe("WebsocketManager disconnected tests", () => {
  const websocketManager = WebsocketManager.getInstance();
  let websocketStub: sinon.SinonStub;

  before(() => {
    // ensure websocket smells not connected at this point
    websocketStub = sinon.stub(websocketManager as any, "websocket").value(null);
  });

  after(() => {
    // restore the original websocket
    websocketStub.restore();
  });

  it("Should not smell connected when websocket is null", () => {
    assert.equal(false, websocketManager.isConnected());
  });

  it("Sending when websocket is not open should throw an error", async () => {
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

    assert.throws(
      () => {
        websocketManager.send(message);
      },
      { message: "Websocket closed" },
    );
  });
});

describe("WebsocketManager connected tests", () => {
  before(async () => {
    await getTestExtensionContext();
  });

  it("Should smell connected when websocket is open", async () => {
    const websocketManager = WebsocketManager.getInstance();
    assert.equal(true, websocketManager.isConnected());
  });

  it("Sending when websocket is open should not throw an error", async () => {
    const message: Message<MessageType.WORKSPACE_HELLO> = {
      headers: newMessageHeaders(MessageType.WORKSPACE_HELLO),
      body: {
        workspace_id: process.pid,
      },
    };

    const websocketManager = WebsocketManager.getInstance();
    websocketManager.send(message);
  });
});

describe("WebsocketManager dispose tests", () => {
  before(async () => {
    // Will ensure that at onset of these tests, the websocket is connected
    await getTestExtensionContext();
  });

  it("WebsocketManager.dispose() should close websocket", async () => {
    const websocketManager = WebsocketManager.getInstance();
    assert.equal(true, websocketManager.isConnected());
    websocketManager.dispose();
    assert.equal(false, websocketManager.isConnected());
    assert.equal(null, websocketManager["websocket"]);
  });

  after(async () => {
    // getting sidecar handle should kick off websocket reconnection
    await getSidecar();

    const websocketManager = WebsocketManager.getInstance();
    assert.equal(
      true,
      websocketManager.isConnected(),
      "Websocket should be connected after reconnection",
    );
  });
});

describe("WebsocketManager.parseMessage tests", () => {
  it("parseMessage vs bad message structure tests", () => {
    // Nontrivial setups: break clones of GOOD_CCLOUD_CONNECTION_EVENT_MESSAGE by respelling date fields to be something
    // not parseable as a Date.
    const broken_ccloud_connection_event_bad_auth_time: any = JSON.parse(
      JSON.stringify(GOOD_CCLOUD_CONNECTION_EVENT_MESSAGE),
    );
    broken_ccloud_connection_event_bad_auth_time.body.connection.status.authentication.requires_authentication_at =
      "ceci n'est pas une date";

    // likewise for ...ccloud.requires_authentication_at
    const broken_ccloud_connection_event_bad_ccloud_auth_time: any = JSON.parse(
      JSON.stringify(GOOD_CCLOUD_CONNECTION_EVENT_MESSAGE),
    );
    broken_ccloud_connection_event_bad_ccloud_auth_time.body.connection.status.ccloud.requires_authentication_at =
      "ceci n'est pas une date";

    // Also, respell the action to be something unknown.
    const broken_ccloud_connection_event_bad_action: any = JSON.parse(
      JSON.stringify(GOOD_CCLOUD_CONNECTION_EVENT_MESSAGE),
    );
    broken_ccloud_connection_event_bad_action.body.action = "BOGUS";

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

      // various bad body structures for CONNECTION_EVENT
      // bad timestamp formats
      JSON.stringify(broken_ccloud_connection_event_bad_auth_time),
      JSON.stringify(broken_ccloud_connection_event_bad_ccloud_auth_time),
      // bad action
      JSON.stringify(broken_ccloud_connection_event_bad_action),
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

      // CONNECTION_EVENT. Needs post-processing to convert date strings to Date objects,
      // see ws/messageTypes.ts::MessageBodyDeserializers[MessageType.CONNECTION_EVENT]
      GOOD_CCLOUD_CONNECTION_EVENT_MESSAGE,
    ];

    for (const testCase of testCases) {
      const message = WebsocketManager.parseMessage(JSON.stringify(testCase));
      assert.deepStrictEqual(message, testCase);
    }
  });
});

describe("WebsocketManager message recepit + callback routing tests (messageRouter interactions)", () => {
  const manager = WebsocketManager.getInstance();
  let messageRouterStub: sinon.SinonStub;

  const simpleMessage: Message<MessageType.WORKSPACE_COUNT_CHANGED> = {
    headers: {
      message_type: MessageType.WORKSPACE_COUNT_CHANGED,
      originator: "sidecar",
      message_id: "1",
    },
    body: {
      current_workspace_count: 1,
    },
  };

  beforeEach(() => {
    // overlay the messageRouter member with an empty event emitter.
    messageRouterStub = sinon.stub(manager as any, "messageRouter").value(constructMessageRouter());
  });

  afterEach(() => {
    // Restore the stashed event emitter.
    messageRouterStub.restore();
  });

  // test subscribe, deliver lifecycle.
  it("subscribe() tests", async () => {
    let callbackOneCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;
    let callbackTwoCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;

    const callbackOne = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackOneCalledWith = message;
    };

    const callbackTwo = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackTwoCalledWith = message;
    };

    // subscribe both callbacks.
    manager.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackOne);
    manager.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackTwo);

    // deliver message, should call both callbacks
    await manager.deliverToCallbacks(simpleMessage);

    assert.deepStrictEqual(simpleMessage, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);

    // deliver again, should call both callbacks again.
    callbackOneCalledWith = null;
    callbackTwoCalledWith = null;

    await manager.deliverToCallbacks(simpleMessage);

    assert.deepStrictEqual(simpleMessage, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);
  });

  // test once() behavior auto-removing after delivering a single message.
  it("once() tests", async () => {
    let callbackOneCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;
    let callbackTwoCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;

    // Will be registered with just 'once'
    const callbackOne = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackOneCalledWith = message;
    };

    // Will be durably registered with subscribe
    const callbackTwo = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackTwoCalledWith = message;
    };

    // subscribe both callbacks, but one is 'once' and should be removed after single message delivery.
    manager.once(MessageType.WORKSPACE_COUNT_CHANGED, callbackOne);
    manager.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackTwo);

    // deliver, should call both callbacks
    await manager.deliverToCallbacks(simpleMessage);

    assert.deepStrictEqual(simpleMessage, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);

    // deliver again, will only call callbackTwo.
    callbackOneCalledWith = null;
    callbackTwoCalledWith = null;
    await manager.deliverToCallbacks(simpleMessage);
    assert.deepStrictEqual(null, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);
  });

  it("Delivery of unknown message type should not raise any error", async () => {
    const unknownMessageTypeMessage: Message<MessageType> = {
      headers: {
        message_type: "UNKNOWN" as MessageType,
        originator: "sidecar",
        message_id: "1",
      },
      body: {} as WorkspacesChangedBody,
    };

    await manager.deliverToCallbacks(unknownMessageTypeMessage);
  });

  it("Delivering message when no callbacks are registered should not raise any error", async () => {
    await manager.deliverToCallbacks(simpleMessage);
  });

  it("Errors raised by some callbacks do not prevent other callbacks from being called", async () => {
    let callbackTwoCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;
    let callbackThreeCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;
    let raised = false;

    const callbackOne = async () => {
      raised = true;
      throw new Error("callbackOne error");
    };

    const callbackTwo = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackTwoCalledWith = message;
    };

    const callbackThree = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackThreeCalledWith = message;
    };

    //
    manager.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackOne);
    manager.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackTwo);
    manager.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackThree);

    // Should call all callbacks, starting with callbackOne, which will raise an error.
    // The error should not prevent the other callbacks from being called.
    await manager.deliverToCallbacks(simpleMessage);

    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackThreeCalledWith);
    assert.strictEqual(true, raised);
  });
});
