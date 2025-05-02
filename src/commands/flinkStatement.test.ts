import assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";

import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { FlinkStatementDocumentProvider } from "../documentProviders/flinkStatement";
import { FlinkStatement } from "../models/flinkStatement";
import { viewStatementSqlCommand } from "./flinkStatements";

describe("viewStatementSqlCommand", () => {
  let sandbox: sinon.SinonSandbox;

  let showTextDocumentStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should hate undefined statement", async () => {
    const result = await viewStatementSqlCommand(undefined as unknown as FlinkStatement);
    assert.strictEqual(result, undefined);
  });

  it("should hate non-FlinkStatement statement", async () => {
    const result = await viewStatementSqlCommand({} as FlinkStatement);
    assert.strictEqual(result, undefined);
  });

  it("should open a read-only document for a FlinkStatement", async () => {
    const statement = createFlinkStatement({
      sqlStatement: "SELECT * FROM my_test_flink_statement_table",
    });
    const uri = FlinkStatementDocumentProvider.getStatementDocumentUri(statement);

    await viewStatementSqlCommand(statement);

    assert.strictEqual(showTextDocumentStub.callCount, 1);
    assert.strictEqual(showTextDocumentStub.firstCall.args[0].uri.toString(), uri.toString());
    assert.strictEqual(showTextDocumentStub.firstCall.args[1].preview, false);
  });
});
