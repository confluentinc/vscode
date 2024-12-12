import assert from "assert";
import "mocha";
import { CallbackMap, MessageRouter } from "./messageRouter";
import { Audience, Message, MessageType } from "./messageTypes";

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

    // the callbacks for this type should just have a registration callbackTwo. callbackOne should have been removed.
    const remainingCallbacks = messageRouter["callbacks"].get(MessageType.WORKSPACE_COUNT_CHANGED);
    assert.deepStrictEqual(
      [{ callback: callbackTwo, once: false, registrationToken: tokenTwo }],
      remainingCallbacks,
    );
  });
});
