import * as assert from "assert";

import { TEST_CCLOUD_ENVIRONMENT_ID } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../tests/unit/testResources/flinkStatement";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { FlinkStatement, FlinkStatementTreeItem } from "./flinkStatement";

describe("FlinkStatement", () => {
  it("uses name as id", () => {
    const statement = new FlinkStatement({
      connectionId: CCLOUD_CONNECTION_ID,
      connectionType: ConnectionType.Ccloud,
      environmentId: TEST_CCLOUD_ENVIRONMENT_ID,
      computePoolId: "ckp-456",
      name: "my-statement",
      status: "RUNNING",
    });

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
});
