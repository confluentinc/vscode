import assert from "assert";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon, { SinonSandbox } from "sinon";
import { ConnectionType } from "../clients/sidecar/models/ConnectionType";
import { createFlinkArtifactToolTip, FlinkArtifact } from "./flinkArtifact";
import { ConnectionId, EnvironmentId } from "./resource";

describe("FlinkArtifactTreeItem", () => {
  let sandbox: SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("createFlinkArtifactToolTip", () => {
    it("should return a CustomMarkdownString with all artifact details", () => {
      const artifact = new FlinkArtifact({
        connectionId: "conn-2" as ConnectionId,
        connectionType: ConnectionType.Ccloud,
        environmentId: "env-2" as EnvironmentId,
        id: "artifact-2",
        name: "Another Artifact",
        description: "Another description.",
        provider: "Azure",
        region: "australiaeast",
      });

      const tooltip = createFlinkArtifactToolTip(artifact);
      const tooltipValue = tooltip.value;

      assert.strictEqual(typeof tooltipValue, "string");
      assert.match(tooltipValue, /Description: : `Another description\.`/);
      assert.match(tooltipValue, /Cloud: : `Azure`/);
      assert.match(tooltipValue, /Region: : `australiaeast`/);
    });
  });
});
