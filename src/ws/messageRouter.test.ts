import assert from "assert";
import { EventEmitter } from "node:events";
import { MessageRouter, createMessageRouterEventEmitter } from "./messageRouter";
import { Message, MessageType, WorkspacesChangedBody } from "./messageTypes";

// tests over MessageRouter

describe("MessageRouter tests", () => {
  const messageRouter = MessageRouter.getInstance();
  let stashedEmitter: EventEmitter;

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
    // Stash the current emitters
    stashedEmitter = messageRouter["emitter"];

    // build new empty emitter and inject it
    messageRouter["emitter"] = createMessageRouterEventEmitter();
  });

  afterEach(() => {
    // Restore the stashed event emitter.
    messageRouter["emitter"] = stashedEmitter;
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
    messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackOne);
    messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackTwo);

    // deliver message, should call both callbacks
    await messageRouter.deliver(simpleMessage);

    assert.deepStrictEqual(simpleMessage, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);

    // deliver again, should call both callbacks again.
    callbackOneCalledWith = null;
    callbackTwoCalledWith = null;

    await messageRouter.deliver(simpleMessage);

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
    messageRouter.once(MessageType.WORKSPACE_COUNT_CHANGED, callbackOne);
    const tokenTwo = messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackTwo);

    // deliver, should call both callbacks
    await messageRouter.deliver(simpleMessage);

    assert.deepStrictEqual(simpleMessage, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);

    // deliver again, will only call callbackTwo.
    callbackOneCalledWith = null;
    callbackTwoCalledWith = null;
    await messageRouter.deliver(simpleMessage);
    assert.deepStrictEqual(null, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);
  });

  it("Delivery of unknown message type should not raise any error", async () => {
    const unknownMessageType: Message<MessageType> = {
      headers: {
        message_type: "UNKNOWN" as MessageType,
        originator: "sidecar",
        message_id: "1",
      },
      body: {} as WorkspacesChangedBody,
    };

    await messageRouter.deliver(unknownMessageType);
  });

  it("Delivering message when no callbacks are registered should not raise any error", async () => {
    await messageRouter.deliver(simpleMessage);
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
    messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackOne);
    messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackTwo);
    messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackThree);

    // Should call all callbacks, starting with callbackOne, which will raise an error.
    // The error should not prevent the other callbacks from being called.
    await messageRouter.deliver(simpleMessage);

    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackThreeCalledWith);
    assert.strictEqual(true, raised);
  });
});
