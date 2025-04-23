import assert from "assert";
import sinon from "sinon";

import { FlinkStatement } from "../models/flinkStatement";
import { viewStatementSqlCommand } from "./flinkStatements";

describe("viewStatementSqlCommand", () => {
  let sandbox: sinon.SinonSandbox;

  // let showTextDocumentStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
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
});
