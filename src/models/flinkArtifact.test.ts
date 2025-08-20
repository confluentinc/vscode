import assert from "assert";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon, { SinonSandbox } from "sinon";
import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar/models/ConnectionType";
import { FlinkArtifact, FlinkArtifactTreeItem } from "./flinkArtifact";
import { ConnectionId, EnvironmentId } from "./resource";

describe("FlinkArtifactTreeItem", () => {
  let sandbox: SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("constructor", () => {
    const artifact = new FlinkArtifact({
      connectionId: "conn-1" as ConnectionId,
      connectionType: ConnectionType.Ccloud,
      environmentId: "env-1" as EnvironmentId,
      id: "artifact-1",
      name: "Test Artifact",
      description: "A test artifact for Flink.",
      provider: "Azure",
      region: "australiaeast",
    });
    it("should set the tooltip with artifact details in Markdown", () => {
      const treeItem = new FlinkArtifactTreeItem(artifact);

      const tooltip = treeItem.tooltip as vscode.MarkdownString;
      const tooltipValue = tooltip.value;

      assert.strictEqual(typeof tooltipValue, "string", "Tooltip value should be a string");
      assert.match(tooltipValue, /\*\*Test Artifact\*\*/, "Tooltip should include artifact name");
      assert.match(
        tooltipValue,
        /A test artifact for Flink\./,
        "Tooltip should include description",
      );
      assert.match(tooltipValue, /Cloud: Azure/, "Tooltip should include provider");
      assert.match(tooltipValue, /Region: australiaeast/, "Tooltip should include region");
    });
  });
});
