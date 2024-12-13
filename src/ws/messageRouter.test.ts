import assert from "assert";
import "mocha";
import { CallbackEntry, CallbackMap, MessageRouter } from "./messageRouter";
import { Audience, Message, MessageType, WorkspacesChangedBody } from "./messageTypes";

// tests over MessageRouter

describe("MessageRouter tests", () => {
  const messageRouter = MessageRouter.getInstance();
  let stashedCallbacks: CallbackMap;

  const simpleMessage: Message<MessageType.WORKSPACE_COUNT_CHANGED> = {
    headers: {
      message_type: MessageType.WORKSPACE_COUNT_CHANGED,
      audience: Audience.WORKSPACES,
      originator: "sidecar",
      message_id: "1",
    },
    body: {
      current_workspace_count: 1,
    },
  };

  beforeEach(() => {
    // Stash the current callbacks
    stashedCallbacks = messageRouter["callbacks"];

    // build new empty callbacks
    const newCallbacks: CallbackMap = new Map();
    for (const messageType in MessageType) {
      newCallbacks.set(messageType as MessageType, []);
    }

    // and inject them.
    messageRouter["callbacks"] = newCallbacks;
  });

  afterEach(() => {
    // Restore the stashed callbacks
    messageRouter["callbacks"] = stashedCallbacks;
  });

  // test subscribe, deliver, unsubscribe lifecycle.
  it("subscribe() and unsubscribe() tests", async () => {
    let callbackOneCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;
    let callbackTwoCalledWith: Message<MessageType.WORKSPACE_COUNT_CHANGED> | null = null;

    const callbackOne = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackOneCalledWith = message;
    };

    const callbackTwo = async (message: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
      callbackTwoCalledWith = message;
    };

    // subscribe both callbacks.
    const tokenOne = messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackOne);
    const tokenTwo = messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, callbackTwo);

    // deliver message, should call both callbacks
    await messageRouter.deliver(simpleMessage);

    console.log("after deliver");

    assert.deepStrictEqual(simpleMessage, callbackOneCalledWith);
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);

    // unsubscribe callback one.
    messageRouter.unsubscribe(tokenOne);

    // clear called withs, then redilver. Should only call callbackTwo.
    callbackOneCalledWith = null;
    callbackTwoCalledWith = null;

    await messageRouter.deliver(simpleMessage);

    // callback one should not have been called, since was unsubscribed.
    assert.deepStrictEqual(null, callbackOneCalledWith);
    // but callback two should have been called.
    assert.deepStrictEqual(simpleMessage, callbackTwoCalledWith);

    // unsubscribe callback two.
    messageRouter.unsubscribe(tokenTwo);

    // the callbacks for this type should be empty now.
    assert.deepStrictEqual([], messageRouter["callbacks"].get(MessageType.WORKSPACE_COUNT_CHANGED));
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

    // the callbacks for this type should just have a registration for callbackTwo. callbackOne should have been removed.
    const remainingCallbacks = messageRouter["callbacks"].get(MessageType.WORKSPACE_COUNT_CHANGED);
    assert.deepStrictEqual(
      [
        {
          callback: callbackTwo,
          once: false,
          registrationToken: tokenTwo,
        } as CallbackEntry<MessageType.WORKSPACE_COUNT_CHANGED>,
      ],
      remainingCallbacks,
    );

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
        audience: Audience.WORKSPACES,
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

  it("test errors raised by some callbacks do not prevent other callbacks from being called", async () => {
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
