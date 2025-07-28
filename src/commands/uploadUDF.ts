import { PresignedUploadUrlArtifactV1PresignedUrlRequest } from "../clients/flinkArtifacts";
import { logError } from "../errors";
import { EnvironmentId, IEnvProviderRegion } from "../models/resource";
import { getSidecar } from "../sidecar";

/**
 * Requests a presigned upload URL for a Flink artifact using the sidecar.
 * @param request PresignedUploadUrlArtifactV1PresignedUrlRequest
 * @returns The presigned URL response object, or undefined if the request fails.
 */
export async function getPresignedUploadUrl(
  request: PresignedUploadUrlArtifactV1PresignedUrlRequest,
): Promise<unknown | undefined> {
  try {
    const sidecarHandle = await getSidecar();
    const providerRegion: IEnvProviderRegion = {
      environmentId: request.environment as EnvironmentId,
      provider: request.cloud,
      region: request.region,
    };
    const artifactsClient = sidecarHandle.getFlinkArtifactsApi(providerRegion);

    // Wrap the request as required by the OpenAPI client
    const urlResponse = await artifactsClient.presignedUploadUrlArtifactV1PresignedUrl({
      PresignedUploadUrlArtifactV1PresignedUrlRequest: request,
    });
    return urlResponse;
  } catch (err) {
    logError(err, "Failed to get presigned upload URL");
    return undefined;
  }
}
