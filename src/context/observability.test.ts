import * as assert from "assert";
import { version as sidecarVersion } from "ide-sidecar";
import type { Extension, ExtensionContext } from "vscode";
import { extensions } from "vscode";
import { EXTENSION_ID } from "../constants";
import { observabilityContext } from "./observability";

describe("ObservabilityContext", () => {
  it("should convert to markdown table correctly", async () => {
    let extensionVersion = "";
    let extensionActivated = false;

    // if another test activated the extension, this will be set
    const extensionInstance: Extension<ExtensionContext> | undefined =
      extensions.getExtension(EXTENSION_ID);
    if (extensionInstance) {
      extensionActivated = extensionInstance.isActive;
      if (extensionActivated) {
        extensionVersion = extensionInstance.packageJSON.version;
      }
    }

    const table = observabilityContext.toMarkdownTable();

    // only check the first few rows of the table since the rest will be adjusted as needed
    const expectedTableHead = `| Key | Value |
| --- | --- |`;
    assert.ok(table.startsWith(expectedTableHead), `Wrong markdown table head, got:\n${table}`);
    assert.ok(
      table.includes(`| extensionVersion | "${extensionVersion}"`),
      `Wrong extensionVersion line, got:\n${table}\n\nExpected ${extensionVersion}`,
    );
    assert.ok(
      table.includes(`| extensionActivated | ${extensionActivated}`),
      `Wrong extensionActivated line, got:\n${table}\n\nExpected ${extensionActivated}`,
    );
    assert.ok(
      table.includes(`| sidecarVersion | "${sidecarVersion}" |`),
      `Wrong sidecarVersion line, got:\n${table}\n\nExpected ${sidecarVersion}`,
    );
  });
});
