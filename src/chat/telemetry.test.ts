import * as assert from "assert";
import { randomUUID } from "crypto";
import * as sinon from "sinon";
import {
  ChatErrorDetails,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { CHAT_SEND_ERROR_DATA, CHAT_SEND_TOOL_CALL_DATA } from "../preferences/constants";
import { sanitizeFeedbackResult } from "./telemetry";
import { TextOnlyToolResultPart } from "./tools/base";
import { ToolCallMetadata } from "./tools/types";
import { CustomChatResult } from "./types";

const fakeModelInfo = {
  id: "gpt-4o",
  vendor: "copilot",
  family: "gpt-4o",
  version: "gpt-4o-2024-11-20",
  name: "GPT-4o",
  capabilities: {
    supportsImageToText: true,
    supportsToolCalling: true,
  },
  maxInputTokens: 63833,
};
const fakeErrorDetails: ChatErrorDetails = { message: "Uh oh" };

describe("chat/telemetry.ts sanitizeFeedbackResult", () => {
  let sandbox: sinon.SinonSandbox;
  let getConfigStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    getConfigStub = sandbox.stub();
    sandbox.stub(workspace, "getConfiguration").returns({
      get: getConfigStub,
      update: sandbox.stub(),
      has: sandbox.stub(),
      inspect: sandbox.stub(),
    } as unknown as WorkspaceConfiguration);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should always include modelInfo", () => {
    // not sending any error details or tool call inputs/contents
    getConfigStub.withArgs(CHAT_SEND_ERROR_DATA).returns(false);
    getConfigStub.withArgs(CHAT_SEND_TOOL_CALL_DATA).returns(false);

    const result: CustomChatResult = {
      errorDetails: fakeErrorDetails,
      metadata: {
        modelInfo: fakeModelInfo,
      },
    };
    const sanitizedResult = sanitizeFeedbackResult(result);

    assert.deepStrictEqual(sanitizedResult, {
      modelInfo: fakeModelInfo,
      // no toolCallNames
      // no errorDetails
      // no toolsCalled
    });
  });

  it("should include modelInfo even if 'capabilities' is undefined", () => {
    // not sending any error details or tool call inputs/contents
    getConfigStub.withArgs(CHAT_SEND_ERROR_DATA).returns(false);
    getConfigStub.withArgs(CHAT_SEND_TOOL_CALL_DATA).returns(false);

    const modelInfoWithoutCapabilities = {
      ...fakeModelInfo,
      capabilities: undefined,
    };

    const result: CustomChatResult = {
      errorDetails: fakeErrorDetails,
      metadata: {
        modelInfo: modelInfoWithoutCapabilities,
      },
    };
    const sanitizedResult = sanitizeFeedbackResult(result);
    assert.deepStrictEqual(sanitizedResult, {
      modelInfo: modelInfoWithoutCapabilities,
      // no toolCallNames
      // no errorDetails
      // no toolsCalled
    });
  });

  it("should return an empty result when no configuration options are enabled", () => {
    // not sending any error details or tool call inputs/contents
    getConfigStub.withArgs(CHAT_SEND_ERROR_DATA).returns(false);
    getConfigStub.withArgs(CHAT_SEND_TOOL_CALL_DATA).returns(false);

    const toolNames = ["tool1", "tool2"];
    const toolMetadatas: ToolCallMetadata[] = toolNames.map((toolName) =>
      createFakeToolCallMetadata(toolName),
    );
    const result: CustomChatResult = {
      errorDetails: fakeErrorDetails,
      metadata: {
        modelInfo: fakeModelInfo,
        toolsCalled: toolMetadatas,
      },
    };
    const sanitizedResult = sanitizeFeedbackResult(result);

    assert.deepStrictEqual(sanitizedResult, {
      modelInfo: fakeModelInfo,
      toolCallNames: toolNames,
      // no errorDetails
      // no toolsCalled
    });
  });

  it(`should include error details when "${CHAT_SEND_ERROR_DATA}" is enabled`, () => {
    // sending error details but not tool call inputs/contents
    getConfigStub.withArgs(CHAT_SEND_ERROR_DATA).returns(true);
    getConfigStub.withArgs(CHAT_SEND_TOOL_CALL_DATA).returns(false);

    const toolNames = ["tool1", "tool2"];
    const toolMetadatas: ToolCallMetadata[] = toolNames.map((toolName) =>
      createFakeToolCallMetadata(toolName),
    );
    const result: CustomChatResult = {
      errorDetails: fakeErrorDetails,
      metadata: {
        modelInfo: fakeModelInfo,
        toolsCalled: toolMetadatas,
      },
    };
    const sanitizedResult = sanitizeFeedbackResult(result);

    assert.deepStrictEqual(sanitizedResult, {
      modelInfo: fakeModelInfo,
      toolCallNames: toolNames,
      errorDetails: fakeErrorDetails,
      // no toolsCalled
    });
  });

  it(`should include 'toolsCalled' content when "${CHAT_SEND_TOOL_CALL_DATA}" is enabled`, () => {
    getConfigStub.withArgs(CHAT_SEND_ERROR_DATA).returns(false);
    getConfigStub.withArgs(CHAT_SEND_TOOL_CALL_DATA).returns(true);

    const toolNames = ["tool1", "tool2"];
    const toolMetadatas: ToolCallMetadata[] = toolNames.map((toolName) =>
      createFakeToolCallMetadata(toolName),
    );
    const result: CustomChatResult = {
      errorDetails: fakeErrorDetails,
      metadata: {
        modelInfo: fakeModelInfo,
        toolsCalled: toolMetadatas,
      },
    };

    const sanitizedResult = sanitizeFeedbackResult(result);

    assert.deepStrictEqual(sanitizedResult, {
      modelInfo: fakeModelInfo,
      toolCallNames: toolNames,
      // no errorDetails
      toolsCalled: toolMetadatas,
    });
  });

  it("should not include tool call fields when 'toolsCalled' is undefined", () => {
    // not sending any error details or tool call inputs/contents
    getConfigStub.withArgs(CHAT_SEND_ERROR_DATA).returns(false);
    getConfigStub.withArgs(CHAT_SEND_TOOL_CALL_DATA).returns(false);

    const result: CustomChatResult = {
      errorDetails: fakeErrorDetails,
      metadata: {
        modelInfo: fakeModelInfo,
      },
    };
    const sanitizedResult = sanitizeFeedbackResult(result);

    assert.deepStrictEqual(sanitizedResult, {
      modelInfo: fakeModelInfo,
      // no toolCallNames
      // no errorDetails
      // no toolsCalled (since it was undefined)
    });
  });

  it(`should include all fields when both "${CHAT_SEND_ERROR_DATA}" and "${CHAT_SEND_TOOL_CALL_DATA}" are enabled`, () => {
    // sending error details and tool call inputs/contents
    getConfigStub.withArgs(CHAT_SEND_ERROR_DATA).returns(true);
    getConfigStub.withArgs(CHAT_SEND_TOOL_CALL_DATA).returns(true);

    const toolNames = ["tool1", "tool2"];
    const toolMetadatas: ToolCallMetadata[] = toolNames.map((toolName) =>
      createFakeToolCallMetadata(toolName),
    );
    const result: CustomChatResult = {
      errorDetails: fakeErrorDetails,
      metadata: {
        modelInfo: fakeModelInfo,
        toolsCalled: toolMetadatas,
      },
    };
    const sanitizedResult = sanitizeFeedbackResult(result);

    assert.deepStrictEqual(sanitizedResult, {
      modelInfo: fakeModelInfo,
      toolCallNames: toolNames,
      errorDetails: fakeErrorDetails,
      toolsCalled: toolMetadatas,
    });
  });
});

/** Create a fake {@link ToolCallMetadata} object for testing. */
function createFakeToolCallMetadata(toolName: string): ToolCallMetadata {
  const toolCallId = "test-call-" + randomUUID();

  const fakeToolCall = new LanguageModelToolCallPart(toolCallId, toolName, { key: "value" });
  const fakeToolResult = new TextOnlyToolResultPart(toolCallId, [
    new LanguageModelTextPart("Here are results from the tool call."),
  ]);

  const metadata: ToolCallMetadata = {
    request: fakeToolCall,
    response: fakeToolResult,
  };
  return metadata;
}
