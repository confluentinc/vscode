import * as assert from "assert";
import { LanguageModelChatMessage, LanguageModelChatMessageRole } from "vscode";
import { PARTICIPANT_ID } from "./constants";
import { participantMessage, systemMessage, userMessage } from "./messageTypes";

describe("chat/messageTypes.ts", () => {
  it("userMessage() should return a User message with a 'user' name", () => {
    const msg: LanguageModelChatMessage = userMessage("hello");

    assert.strictEqual(msg.content, "hello");
    assert.strictEqual(msg.name, "user");
    assert.strictEqual(msg.role, LanguageModelChatMessageRole.User);
  });

  it("participantMessage() should return an Assistant message with the participant ID as a name", () => {
    const msg: LanguageModelChatMessage = participantMessage("beep boop");

    assert.strictEqual(msg.content, "beep boop");
    assert.strictEqual(msg.name, PARTICIPANT_ID);
    assert.strictEqual(msg.role, LanguageModelChatMessageRole.Assistant);
  });

  it("systemMessage() should return a User message with a SYSTEM prefix and name", () => {
    const msg: LanguageModelChatMessage = systemMessage("you are helpful");

    assert.strictEqual(msg.content, "SYSTEM: you are helpful");
    assert.strictEqual(msg.name, "system");
    assert.strictEqual(msg.role, LanguageModelChatMessageRole.User);
  });
});
