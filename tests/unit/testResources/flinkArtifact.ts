import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../../src/constants";
import { FlinkArtifact } from "../../../src/models/flinkArtifact";
import { ConnectionId, EnvironmentId } from "../../../src/models/resource";
import { TEST_CCLOUD_ENVIRONMENT_ID } from "./environments";

export const TEST_CCLOUD_FLINK_ARTIFACT = createFlinkArtifact();

export interface CreateFlinkArtifactArgs {
  connectionId?: ConnectionId;
  connectionType?: ConnectionType;
  environmentId?: EnvironmentId;
  id?: string;
  name?: string;
  description?: string;
  provider?: string;
  region?: string;
}

export function createFlinkArtifact(overrides: CreateFlinkArtifactArgs = {}): FlinkArtifact {
  return new FlinkArtifact({
    connectionId: overrides.connectionId || CCLOUD_CONNECTION_ID,
    connectionType: overrides.connectionType || ConnectionType.Ccloud,
    environmentId: overrides.environmentId || TEST_CCLOUD_ENVIRONMENT_ID,
    id: overrides.id || "artifact-123",
    name: overrides.name || "Test Artifact",
    description: overrides.description || "Test artifact description",
    provider: overrides.provider || "aws",
    region: overrides.region || "us-east-1",
  });
}
