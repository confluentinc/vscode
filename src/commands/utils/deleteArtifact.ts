import * as vscode from "vscode";
import { DeleteArtifactV1FlinkArtifactRequest } from "../../clients/flinkArtifacts/apis/FlinkArtifactsArtifactV1Api";
import { artifactUploadDeleted } from "../../emitters";
import { FlinkArtifact } from "../../models/flinkArtifact";
import { EnvironmentId, IEnvProviderRegion } from "../../models/resource";
import { getSidecar } from "../../sidecar";

export async function deleteArtifactCommand(
  selectedArtifact: FlinkArtifact | undefined,
): Promise<void> {
  if (!selectedArtifact) {
    void vscode.window.showErrorMessage(
      "Cannot delete artifact: missing required artifact properties.",
    );
    return;
  }
  const request: DeleteArtifactV1FlinkArtifactRequest = {
    cloud: selectedArtifact.provider,
    region: selectedArtifact.region,
    environment: selectedArtifact.environmentId,
    id: selectedArtifact.id,
  };
  const sidecarHandle = await getSidecar();
  const providerRegion: IEnvProviderRegion = {
    region: request.region,
    environmentId: request.environment as EnvironmentId,
    provider: request.cloud,
  };
  const artifactsClient = sidecarHandle.getFlinkArtifactsApi(providerRegion);

  const yesButton = "Yes, delete";
  const confirmation = await vscode.window.showWarningMessage(
    `Are you sure you want to delete "${selectedArtifact.name}"?`,
    {
      modal: true,
      detail:
        "Deleting this artifact will disable all User-Defined Functions (UDFs) created from it. Consequently, any Flink statements that utilize these UDFs will also fail. This action cannot be undone.",
    },
    { title: yesButton },
    // "Cancel" is added by default
  );
  if (confirmation?.title !== yesButton) {
    return;
  }

  await artifactsClient.deleteArtifactV1FlinkArtifact(request);
  artifactUploadDeleted.fire();
  void vscode.window.showInformationMessage(
    `Artifact "${selectedArtifact.name}" deleted successfully from Confluent Cloud.`,
  );
}
