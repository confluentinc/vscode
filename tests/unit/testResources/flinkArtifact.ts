import { ArtifactV1FlinkArtifactMetadataFromJSON } from "../../../src/clients/flinkArtifacts";
import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../../src/constants";
import { FlinkArtifact } from "../../../src/models/flinkArtifact";
import { TEST_CCLOUD_ENVIRONMENT_ID } from "./environments";

export const TEST_CCLOUD_FLINK_ARTIFACT = createFlinkArtifact();

export function createFlinkArtifact(overrides: Partial<FlinkArtifact> = {}): FlinkArtifact {
  return new FlinkArtifact({
    connectionId: overrides.connectionId || CCLOUD_CONNECTION_ID,
    connectionType: overrides.connectionType || ConnectionType.Ccloud,
    environmentId: overrides.environmentId || TEST_CCLOUD_ENVIRONMENT_ID,
    id: overrides.id || "artifact-123",
    name: overrides.name || "Test Artifact",
    description: overrides.description || "Test artifact description",
    provider: overrides.provider || "aws",
    region: overrides.region || "us-east-1",
    documentationLink: overrides.documentationLink || "",
    metadata:
      overrides.metadata ||
      ArtifactV1FlinkArtifactMetadataFromJSON({
        self: {},
        resource_name: "test-artifact",
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: new Date(),
      }),
  });
}
