import assert from "assert";
import { MessageType, validateMessageBody } from "./messageTypes";

describe("validateMessageBody tests", () => {
  it("validateMessageBody vs good message body tests", () => {
    const testCases: { messageType: MessageType; body: any; label: string }[] = [
      // WORKSPACE_COUNT_CHANGED
      {
        messageType: MessageType.WORKSPACE_COUNT_CHANGED,
        body: { current_workspace_count: 3 },
        label: "WORKSPACE_COUNT_CHANGED three workspaces",
      },

      // PROTOCOL_ERROR
      {
        messageType: MessageType.PROTOCOL_ERROR,
        body: { error: "received bad message" },
        label: "PROTOCOL_ERROR received bad message",
      },
    ];

    for (const testCase of testCases) {
      assert.doesNotThrow(() => {
        validateMessageBody(testCase.messageType, testCase.body);
      }, testCase.label);
    }
  });

  it("validateMessageBody vs bad message body tests", () => {
    const testCases: { messageType: MessageType; body: any; label: string }[] = [
      // WORKSPACE_COUNT_CHANGED
      {
        label: "WORKSPACE_COUNT_CHANGED random body structure",
        messageType: MessageType.WORKSPACE_COUNT_CHANGED,
        body: { foo: "bar" },
      },

      {
        label: "WORKSPACE_COUNT_CHANGED undefined body",
        messageType: MessageType.WORKSPACE_COUNT_CHANGED,
        body: undefined,
      },

      {
        label: "WORKSPACE_COUNT_CHANGED non-object body",
        messageType: MessageType.WORKSPACE_COUNT_CHANGED,
        body: 12,
      },

      {
        label: "WORKSPACE_COUNT_CHANGED non-numeric current_workspace_count",
        messageType: MessageType.WORKSPACE_COUNT_CHANGED,
        body: { current_workspace_count: "foo" },
      },

      // PROTOCOL_ERROR
      {
        label: "PROTOCOL_ERROR random body structure",
        messageType: MessageType.PROTOCOL_ERROR,
        body: { foo: "bar" },
      },

      {
        label: "PROTOCOL_ERROR undefined body",
        messageType: MessageType.PROTOCOL_ERROR,
        body: undefined,
      },

      {
        label: "PROTOCOL_ERROR non-object body",
        messageType: MessageType.PROTOCOL_ERROR,
        body: 12,
      },

      {
        label: "PROTOCOL_ERROR non-string error",
        messageType: MessageType.PROTOCOL_ERROR,
        body: { error: 12 },
      },

      // Completely unknown message type
      {
        label: "Completely unknown message type",
        messageType: "UNKNOWN" as MessageType,
        body: { foo: "bar" },
      },
    ];

    for (const testCase of testCases) {
      assert.throws(
        () => {
          validateMessageBody(testCase.messageType, testCase.body);
        },
        /(Invalid body)|(Unknown message type)/,
        `${testCase.label} should throw but didn't`,
      );
    }
  });
});
