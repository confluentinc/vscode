import assert from "assert";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { FlinkStatementDocumentProvider } from "./flinkStatement";

describe("FlinkStatementDocumentProvider", () => {
  const provider: FlinkStatementDocumentProvider = new FlinkStatementDocumentProvider();

  it("getStatementDocumentUri() / provideTextDocumentContent round trip", async () => {
    const statementSQL = "SELECT * FROM my_test_flink_statement_table";
    const testStatement = createFlinkStatement({ sqlStatement: statementSQL });

    // Should be able to round-trip the statement SQL through the URI and provideTextDocumentContent().
    const uri = FlinkStatementDocumentProvider.getStatementDocumentUri(testStatement);
    const content = await provider.provideTextDocumentContent(uri);

    assert.strictEqual(
      content,
      statementSQL,
      "The content of the document should match the SQL statement in the FlinkStatement",
    );
  });
});
