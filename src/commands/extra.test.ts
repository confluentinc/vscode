import * as assert from "assert";
import * as sinon from "sinon";
import { env, window } from "vscode";
import {
  TEST_FLINK_RELATION,
  TEST_VARCHAR_COLUMN,
} from "../../tests/unit/testResources/flinkRelation";
import {
  TEST_FLINK_TYPE_FIELD_NODE,
  TEST_FLINK_TYPE_NESTED_ARRAY_NODE,
} from "../../tests/unit/testResources/flinkTypeNode";
import { copyNestedPath, copyResourceName } from "./extra";

describe("commands/extra.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let originalClipboardContents: string | undefined;
  let infoMessageStub: sinon.SinonStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Save clipboard contents so we can restore them after tests
    originalClipboardContents = await env.clipboard.readText();
    // Only stub the notification API; use real clipboard
    infoMessageStub = sandbox.stub(window, "showInformationMessage").resolves();
  });

  afterEach(async () => {
    sandbox.restore();
    // Restore clipboard contents
    if (originalClipboardContents !== undefined) {
      await env.clipboard.writeText(originalClipboardContents);
    }
  });

  describe("copyResourceName", () => {
    const testCases: Array<[string, { name: string }]> = [
      ["FlinkRelation (BASE TABLE)", TEST_FLINK_RELATION],
      ["FlinkRelationColumn", TEST_VARCHAR_COLUMN],
    ];

    testCases.forEach(([description, testObject]) => {
      it(`should copy ${description} name to clipboard`, async () => {
        await copyResourceName(testObject);

        const expectedName = testObject.name;
        const clipboardValue = await env.clipboard.readText();

        // Verify clipboard was written
        assert.strictEqual(clipboardValue, expectedName);

        // Verify notification was shown
        sinon.assert.calledOnceWithExactly(
          infoMessageStub,
          `Copied "${expectedName}" to clipboard.`,
        );
      });
    });
  });

  describe("copyNestedPath", () => {
    it(`should copy embedded row field nested path to clipboard`, async () => {
      // the entire id is "test_relation.address.street", but we expect only the
      // nested path "address.street" to be copied for use within SELECT queries, etc.
      await copyNestedPath(TEST_FLINK_TYPE_FIELD_NODE);

      const clipboardValue = await env.clipboard.readText();

      // Verify clipboard was written
      assert.strictEqual(clipboardValue, "address.street");

      // Verify notification was shown
      sinon.assert.calledOnceWithExactly(infoMessageStub, `Copied "address.street" to clipboard.`);
    });

    it("should not copy if nestedPath is undefined", async () => {
      await copyNestedPath(TEST_FLINK_TYPE_NESTED_ARRAY_NODE);

      // Clipboard should not be modified, notification should not be shown
      sinon.assert.notCalled(infoMessageStub);
    });
  });
});
