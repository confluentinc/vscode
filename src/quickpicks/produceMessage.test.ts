import * as assert from "assert";
import sinon from "sinon";
import { window } from "vscode";
import type { ProduceMessage } from "../diagnostics/produceMessage";
import {
  detectControlFields,
  produceControlFieldMultiSelect,
  stripDeselectedControlFields,
} from "./produceMessage";

const messageWithBoth: ProduceMessage = { key: "k", value: "v", partition_id: 3, timestamp: 100 };

describe("quickpicks/produceMessage.ts detectControlFields()", function () {
  it("should report a field present when any record specifies it", function () {
    const contents: ProduceMessage[] = [{ value: "a" }, { value: "b", partition_id: 0 }];

    const present = detectControlFields(contents);

    assert.strictEqual(present.partitionId, true);
    assert.strictEqual(present.timestamp, false);
  });

  it("should treat a `partition_id` of 0 as present", function () {
    // guards against a truthiness check that would miss partition 0
    const present = detectControlFields([{ value: "a", partition_id: 0 }]);

    assert.strictEqual(present.partitionId, true);
  });

  it("should report neither field present for records without control fields", function () {
    const present = detectControlFields([{ value: "a" }, { value: "b" }]);

    assert.deepStrictEqual(present, { partitionId: false, timestamp: false });
  });
});

describe("quickpicks/produceMessage.ts produceControlFieldMultiSelect()", function () {
  let sandbox: sinon.SinonSandbox;
  let showQuickPickStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    showQuickPickStub = sandbox.stub(window, "showQuickPick");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should not show a quickpick and return both false when no control fields are present", async function () {
    const selection = await produceControlFieldMultiSelect([{ value: "a" }]);

    sinon.assert.notCalled(showQuickPickStub);
    assert.deepStrictEqual(selection, { partitionId: false, timestamp: false });
  });

  it("should only offer control fields that are present in the record(s)", async function () {
    // only `partition_id` present, so `timestamp` should not be offered
    showQuickPickStub.resolves([{ label: "Partition ID" }]);

    const selection = await produceControlFieldMultiSelect([{ value: "a", partition_id: 1 }]);

    const offeredItems = showQuickPickStub.firstCall.args[0];
    assert.strictEqual(offeredItems.length, 1);
    assert.strictEqual(offeredItems[0].label, "Partition ID");
    assert.deepStrictEqual(selection, { partitionId: true, timestamp: false });
  });

  it("should pre-select every offered control field", async function () {
    showQuickPickStub.resolves([]);

    await produceControlFieldMultiSelect([messageWithBoth]);

    const offeredItems = showQuickPickStub.firstCall.args[0];
    assert.strictEqual(offeredItems.length, 2);
    assert.ok(offeredItems.every((item: { picked?: boolean }) => item.picked === true));
  });

  it("should mark a field excluded when the user deselects it", async function () {
    // user kept only "Timestamp"
    showQuickPickStub.resolves([{ label: "Timestamp" }]);

    const selection = await produceControlFieldMultiSelect([messageWithBoth]);

    assert.deepStrictEqual(selection, { partitionId: false, timestamp: true });
  });

  it("should return undefined when the user cancels the quickpick", async function () {
    showQuickPickStub.resolves(undefined);

    const selection = await produceControlFieldMultiSelect([messageWithBoth]);

    assert.strictEqual(selection, undefined);
  });
});

describe("quickpicks/produceMessage.ts stripDeselectedControlFields()", function () {
  it("should delete only the deselected control field(s) from every record", function () {
    const contents: ProduceMessage[] = [
      { value: "a", partition_id: 1, timestamp: 100 },
      { value: "b", partition_id: 2, timestamp: 200 },
    ];

    stripDeselectedControlFields(contents, { partitionId: true, timestamp: false });

    assert.strictEqual(contents[0].partition_id, 1);
    assert.strictEqual(contents[0].timestamp, undefined);
    assert.strictEqual(contents[1].partition_id, 2);
    assert.strictEqual(contents[1].timestamp, undefined);
  });

  it("should leave records untouched when both fields are kept", function () {
    const contents: ProduceMessage[] = [{ value: "a", partition_id: 1, timestamp: 100 }];

    stripDeselectedControlFields(contents, { partitionId: true, timestamp: true });

    assert.strictEqual(contents[0].partition_id, 1);
    assert.strictEqual(contents[0].timestamp, 100);
  });
});
