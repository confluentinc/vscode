import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../../tests/unit/testResources/flinkStatement";
import { confirmActionOnStatement } from "./statements";

describe("src/commands/utils/statements.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("confirmActionOnStatement", () => {
    let showWarningMessageStub: sinon.SinonStub;
    const statement = TEST_CCLOUD_FLINK_STATEMENT;

    beforeEach(() => {
      showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage");
    });

    interface ConfirmActionTestCase {
      action: "stop" | "delete";
      resolution: string | undefined;
      expected: boolean;
      description: string;
    }

    const cases: ConfirmActionTestCase[] = [
      {
        action: "stop",
        resolution: "Stop Statement",
        expected: true,
        description: "confirm stop action (user chooses Stop Statement)",
      },
      {
        action: "stop",
        resolution: undefined,
        expected: false,
        description: "cancel stop action (user dismisses prompt)",
      },
      {
        action: "delete",
        resolution: "Delete Statement",
        expected: true,
        description: "confirm delete action (user chooses Delete Statement)",
      },
      {
        action: "delete",
        resolution: undefined,
        expected: false,
        description: "cancel delete action (user dismisses prompt)",
      },
    ];

    for (const { action, resolution, expected, description } of cases) {
      it(`should ${description}`, async () => {
        showWarningMessageStub.resetHistory();
        showWarningMessageStub.resolves(resolution);

        const result = await confirmActionOnStatement(action, statement);

        sinon.assert.calledOnce(showWarningMessageStub);
        assert.strictEqual(result, expected);
      });
    }
  });
});
