import * as assert from "assert";
import { version } from "ide-sidecar";
import { env } from "vscode";
import { observabilityContext } from "./observability";

describe("ObservabilityContext", () => {
  it("should convert to markdown table correctly", async () => {
    const table = observabilityContext.toMarkdownTable();
    // only check the first few rows of the table since the rest will be adjusted as needed
    const expectedTableHead = `| Key | Value |
| --- | --- |
| extensionUriScheme | "${env.uriScheme}" |
| extensionVersion | "" |
| extensionActivated | false |
| sidecarVersion | "${version}" |`;
    assert.ok(table.startsWith(expectedTableHead));
  });
});
