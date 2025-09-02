import * as vscode from "vscode";
import { DeleteArtifactV1FlinkArtifactRequest } from "../../clients/flinkArtifacts/apis/FlinkArtifactsArtifactV1Api";
import { EnvironmentId, IEnvProviderRegion } from "../../models/resource";
import { getSidecar } from "../../sidecar";

export async function deleteArtifactCommand(
  params: DeleteArtifactV1FlinkArtifactRequest,
): Promise<void> {
  const request: DeleteArtifactV1FlinkArtifactRequest = {
    cloud: params.cloud,
    region: params.region,
    environment: params.environment,
    id: params.id,
  };
  const sidecarHandle = await getSidecar();
  const providerRegion: IEnvProviderRegion = {
    region: request.region,
    environmentId: request.environment as EnvironmentId,
    provider: request.cloud,
  };
  const artifactsClient = sidecarHandle.getFlinkArtifactsApi(providerRegion);

  const response = await artifactsClient.deleteArtifactV1FlinkArtifact(request);
  // what type should response be?
  void vscode.window.showInformationMessage(
    `Artifact "${response}" deleted successfully from Confluent Cloud.`,
  );
}
