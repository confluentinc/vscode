import assert from "assert";
import { describe, it } from "mocha";
import { ArtifactV1FlinkArtifactMetadataFromJSON } from "../clients/flinkArtifacts";
import { ConnectionType } from "../clients/sidecar/models/ConnectionType";
import { createFlinkArtifactToolTip, FlinkArtifact } from "./flinkArtifact";
import { ConnectionId, EnvironmentId } from "./resource";

describe("FlinkArtifactTreeItem", () => {
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
        documentationLink: "https://confluent.io",
        metadata: ArtifactV1FlinkArtifactMetadataFromJSON({
          self: {},
          resource_name: "test-artifact",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: new Date(),
        }),
      });

      const tooltip = createFlinkArtifactToolTip(artifact);
      const tooltipValue = tooltip.value;

      assert.strictEqual(typeof tooltipValue, "string");
      assert.match(tooltipValue, /Description: `Another description\.`/);
    });
  });
});
