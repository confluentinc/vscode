import * as assert from "assert";

import { ThemeIcon } from "vscode";
import {
  createFlinkStatement,
  TEST_CCLOUD_FLINK_STATEMENT,
} from "../../tests/unit/testResources/flinkStatement";
import { IconNames } from "../constants";
import {
  FlinkStatement,
  FlinkStatementStatus,
  FlinkStatementTreeItem,
  STATUS_BLUE,
  STATUS_GRAY,
  STATUS_GREEN,
  STATUS_RED,
  STATUS_YELLOW,
} from "./flinkStatement";
import { CustomMarkdownString, KeyValuePairArray } from "./main";
import { EnvironmentId } from "./resource";

describe("FlinkStatement", () => {
  it("uses name as id", () => {
    const statement = createFlinkStatement({ name: "statement0" });

    assert.strictEqual(statement.id, statement.name, "Expect name and id to be the same");
  });
});

describe("FlinkStatementTreeItem", () => {
  // Prove context value is "ccloud-flink-statement"
  it("has the correct context value", () => {
    const statement = TEST_CCLOUD_FLINK_STATEMENT;

    const treeItem = new FlinkStatementTreeItem(statement);
    assert.strictEqual(treeItem.contextValue, "ccloud-flink-statement");
  });

  it("tooltip hits the major properties", () => {
    const statement = createFlinkStatement({
      name: "statement0",
      phase: "RUNNING",
      detail: "Statement is running",
      sqlKind: "SELECT",
      environmentId: "env0" as EnvironmentId,
      computePoolId: "pool0",
    });

    const treeItem = new FlinkStatementTreeItem(statement);
    const tooltip = treeItem.tooltip as CustomMarkdownString;

    const expectedKeyValuePairs: KeyValuePairArray = [
      ["Kind", statement.sqlKindDisplay],
      ["Status", statement.phase],
      ["Created At", statement.createdAt!.toLocaleString()],
      ["Updated At", statement.updatedAt!.toLocaleString()],
      ["Environment", statement.environmentId],
      ["Compute Pool", statement.computePoolId],
      ["Detail", statement.status.detail],
    ];

    for (const [key, value] of expectedKeyValuePairs) {
      assert.ok(tooltip.value.includes(key), `expected key ${key} to be in tooltip`);
      assert.ok(
        tooltip.value.includes(value!),
        `expected value ${value} to be in tooltip for key ${key}\n${tooltip.value}`,
      );
    }
  });

  describe("icon tests", () => {
    it("should use the correct icons and colors based on the `phase`", () => {
      for (const phase of ["FAILED", "FAILING"]) {
        const failStatement = new FlinkStatement({
          ...TEST_CCLOUD_FLINK_STATEMENT,
          status: makeStatus(phase),
        });
        const failTreeItem = new FlinkStatementTreeItem(failStatement);
        const failIcon = failTreeItem.iconPath as ThemeIcon;
        assert.strictEqual(failIcon.id, IconNames.FLINK_STATEMENT_STATUS_FAILED);
        assert.strictEqual(failIcon.color, STATUS_RED);
      }

      const degradedStatement = new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        status: makeStatus("DEGRADED"),
      });
      const degradedTreeItem = new FlinkStatementTreeItem(degradedStatement);
      const degradedIcon = degradedTreeItem.iconPath as ThemeIcon;
      assert.strictEqual(degradedIcon.id, IconNames.FLINK_STATEMENT_STATUS_DEGRADED);
      assert.strictEqual(degradedIcon.color, STATUS_YELLOW);

      const runningStatement = new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        status: makeStatus("RUNNING"),
      });
      const runningTreeItem = new FlinkStatementTreeItem(runningStatement);
      const runningIcon = runningTreeItem.iconPath as ThemeIcon;
      assert.strictEqual(runningIcon.id, IconNames.FLINK_STATEMENT_STATUS_RUNNING);
      assert.strictEqual(runningIcon.color, STATUS_GREEN);

      const completedStatement = new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        status: makeStatus("COMPLETED"),
      });
      const completedTreeItem = new FlinkStatementTreeItem(completedStatement);
      const completedIcon = completedTreeItem.iconPath as ThemeIcon;
      assert.strictEqual(completedIcon.id, IconNames.FLINK_STATEMENT_STATUS_COMPLETED);
      assert.strictEqual(completedIcon.color, STATUS_GRAY);

      for (const phase of ["DELETING", "STOPPING"]) {
        const stopStatement = new FlinkStatement({
          ...TEST_CCLOUD_FLINK_STATEMENT,
          status: makeStatus(phase),
        });
        const stopTreeItem = new FlinkStatementTreeItem(stopStatement);
        const stopIcon = stopTreeItem.iconPath as ThemeIcon;
        assert.strictEqual(stopIcon.id, IconNames.FLINK_STATEMENT_STATUS_DELETING);
        assert.strictEqual(stopIcon.color, STATUS_GRAY);
      }

      const stoppedStatement = new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        status: makeStatus("STOPPED"),
      });
      const stoppedTreeItem = new FlinkStatementTreeItem(stoppedStatement);
      const stoppedIcon = stoppedTreeItem.iconPath as ThemeIcon;
      assert.strictEqual(stoppedIcon.id, IconNames.FLINK_STATEMENT_STATUS_STOPPED);
      assert.strictEqual(stoppedIcon.color, STATUS_BLUE);

      const pendingStatement = new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        status: makeStatus("PENDING"),
      });
      const pendingTreeItem = new FlinkStatementTreeItem(pendingStatement);
      const pendingIcon = pendingTreeItem.iconPath as ThemeIcon;
      assert.strictEqual(pendingIcon.id, IconNames.FLINK_STATEMENT_STATUS_PENDING);
      assert.strictEqual(pendingIcon.color, STATUS_BLUE);
    });

    it("should fall back to a basic icon for untracked phase values", () => {
      const unknownStatement = new FlinkStatement({
        ...TEST_CCLOUD_FLINK_STATEMENT,
        status: makeStatus("UNKNOWN"),
      });
      const unknownTreeItem = new FlinkStatementTreeItem(unknownStatement);
      const unknownIcon = unknownTreeItem.iconPath as ThemeIcon;
      assert.strictEqual(unknownIcon.id, IconNames.FLINK_STATEMENT);
      assert.strictEqual(unknownIcon.color, undefined);
    });
  });
});

function makeStatus(phase: string): FlinkStatementStatus {
  return createFlinkStatement({ phase: phase }).status;
}
