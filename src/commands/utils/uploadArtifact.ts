import path from "path";
import * as vscode from "vscode";
import {
  CreateArtifactV1FlinkArtifact201Response,
  CreateArtifactV1FlinkArtifactRequest,
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import { artifactUploadCompleted } from "../../emitters";
import { logError } from "../../errors";
import { Logger } from "../../logging";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { CCloudKafkaCluster } from "../../models/kafkaCluster";
import {
  CloudProvider,
  EnvironmentId,
  IEnvProviderRegion,
  IProviderRegion,
} from "../../models/resource";
import { showErrorNotificationWithButtons } from "../../notifications";
import { cloudProviderRegionQuickPick } from "../../quickpicks/cloudProviderRegions";
import { flinkCcloudEnvironmentQuickPick } from "../../quickpicks/environments";
import { getSidecar } from "../../sidecar";
import { readFileBuffer } from "../../utils/fsWrappers";
import { uploadFileToAzure, uploadFileToS3 } from "./uploadToProvider";
export { uploadFileToAzure };

export interface ArtifactUploadParams {
  environment: string;
  cloud: string;
  region: string;
  artifactName: string;
  fileFormat: string;
  selectedFile: vscode.Uri;
}

const logger = new Logger("commands/uploadArtifact");

const MAX_FILE_SIZE = 100 * 1024 * 1024; // sets the max file size to 100 MB in 104,857,600 bytes

export const PRESIGNED_URL_LOCATION = "PRESIGNED_URL_LOCATION";

/**
 * Read a file from a VS Code Uri and prepare a Blob (and File if available).
 */
export async function prepareUploadFileFromUri(uri: vscode.Uri): Promise<{
  blob: Blob;
  contentType: string;
}> {
  try {
    const bytes: Uint8Array = await readFileBuffer(uri);
    const ext: string = path.extname(uri.fsPath).toLowerCase();

    const contentType: string =
      ext === ".jar" ? "application/java-archive" : "application/octet-stream";

    const safeBytes = new Uint8Array(bytes);
    const blob: Blob = new Blob([Buffer.from(safeBytes)], { type: contentType });
    if (blob.size > MAX_FILE_SIZE) {
      const errorMessage = `File size ${(blob.size / (1024 * 1024)).toFixed(
        2,
      )}MB exceeds the maximum allowed size of 100MB. Please use a smaller file.`;
      logger.warn("File too large", { fileSize: blob.size });
      throw new Error(errorMessage);
    }
    return { blob, contentType };
  } catch (err) {
    logError(err, `Failed to read file from URI: ${uri.toString()}`);
    throw err;
  }
}

/**
 * Requests a presigned upload URL for a Flink artifact using the sidecar.
 * @param request PresignedUploadUrlArtifactV1PresignedUrlRequest
 * @returns The presigned URL response object, or undefined if the request fails.
 */
export async function getPresignedUploadUrl(
  request: PresignedUploadUrlArtifactV1PresignedUrlRequest,
): Promise<PresignedUploadUrlArtifactV1PresignedUrl200Response> {
  const sidecarHandle = await getSidecar();
  const providerRegion: IEnvProviderRegion = {
    environmentId: request.environment as EnvironmentId,
    provider: request.cloud,
    region: request.region,
  };
  const presignedClient = sidecarHandle.getFlinkPresignedUrlsApi(providerRegion);

  const urlResponse = await presignedClient.presignedUploadUrlArtifactV1PresignedUrl({
    PresignedUploadUrlArtifactV1PresignedUrlRequest: request,
  });
  return urlResponse;
}

export async function promptForArtifactUploadParams(
  item?: CCloudKafkaCluster | CCloudFlinkComputePool | vscode.Uri,
): Promise<ArtifactUploadParams | undefined> {
  const isCcloudItem =
    item && (item instanceof CCloudFlinkComputePool || item instanceof CCloudKafkaCluster);
  if (isCcloudItem) {
    logger.debug("Starting upload artifact using provided context", {
      environment: item.environmentId,
      cloud: item.provider,
      region: item.region,
    });
  }
  // Use the item's environment if provided, otherwise prompt for it
  const environment =
    isCcloudItem && item.environmentId
      ? { id: item.environmentId }
      : await flinkCcloudEnvironmentQuickPick();

  // Use the item's provider and region if exists, otherwise prompt for it
  let cloudRegion: IProviderRegion | undefined;
  if (isCcloudItem) {
    cloudRegion = { provider: item.provider, region: item.region };
  } else {
    cloudRegion = await cloudProviderRegionQuickPick((region) => region.cloud !== "GCP");
  }

  if (!environment || !environment.id || !cloudRegion) {
    return undefined;
  }

  let cloud: CloudProvider;
  if (cloudRegion.provider === "AZURE") {
    cloud = CloudProvider.Azure;
  } else if (cloudRegion.provider === "AWS") {
    cloud = CloudProvider.AWS;
  } else {
    void showErrorNotificationWithButtons(
      `Upload Artifact cancelled: Unsupported cloud provider: ${cloudRegion.provider}`,
    );
    return undefined;
  }

  // If the incoming item is a Uri, use it; otherwise prompt the user
  let selectedFile: vscode.Uri | undefined;
  if (item && item instanceof vscode.Uri) {
    selectedFile = item;
  } else {
    const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
      openLabel: "Select",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "Flink Artifact Files": ["jar"],
      },
    });

    if (!selectedFiles || selectedFiles.length === 0) {
      // if the user cancels the file selection, silently exit
      return undefined;
    }

    selectedFile = selectedFiles[0];
  }

  const fileFormat: string = selectedFile.fsPath.split(".").pop() ?? "";

  // Default artifact name to the selected file's base name (without extension), but allow override.
  const defaultArtifactName = path.basename(selectedFile.fsPath, path.extname(selectedFile.fsPath));

  const artifactName = await vscode.window.showInputBox({
    prompt: "Enter the artifact name",
    value: defaultArtifactName,
    ignoreFocusOut: true,
    validateInput: (value) => (value && value.trim() ? undefined : "Artifact name is required"),
  });

  if (!artifactName) {
    return undefined;
  }

  return {
    environment: environment.id,
    cloud,
    region: cloudRegion.region,
    artifactName,
    fileFormat,
    selectedFile,
  };
}

// PROTOTYPE: quickpick "form" for the whole artifact upload flow
export async function artifactUploadQuickPickForm(): Promise<ArtifactUploadParams | undefined> {
  enum Step {
    Environment = "environment",
    CloudRegion = "cloudRegion",
    File = "file",
    ArtifactName = "artifactName",
    Description = "description",
    DocumentationUrl = "documentationUrl",
    Complete = "complete",
  }

  // track quickpick form state
  interface FormState {
    [Step.Environment]?: { id: string; name: string };
    [Step.CloudRegion]?: { provider: string; region: string };
    [Step.File]?: vscode.Uri;
    [Step.ArtifactName]?: string;
    [Step.Description]?: string;
    [Step.DocumentationUrl]?: string;
    // no need to track "complete" step
  }
  const state: FormState = {};

  const completedIcon = "pass-filled";
  const incompleteIcon = "circle-large-outline";

  const getNextRequiredStep = (): Step | null => {
    if (!state[Step.Environment]) return Step.Environment;
    if (!state[Step.CloudRegion]) return Step.CloudRegion;
    if (!state[Step.File]) return Step.File;
    if (!state[Step.ArtifactName]) return Step.ArtifactName;
    // all required inputs available
    return null;
  };

  const createMenuItems = () => [
    {
      label: `1. Select Environment`,
      description: state[Step.Environment]
        ? `${state[Step.Environment].name} (${state[Step.Environment].id})`
        : "Not selected",
      iconPath: new vscode.ThemeIcon(state[Step.Environment] ? completedIcon : incompleteIcon),
      value: Step.Environment,
    },
    {
      label: `2. Select Cloud Provider & Region`,
      description: state[Step.CloudRegion]
        ? `${state[Step.CloudRegion].provider} - ${state[Step.CloudRegion].region}`
        : "Not selected",
      iconPath: new vscode.ThemeIcon(state[Step.CloudRegion] ? completedIcon : incompleteIcon),
      value: Step.CloudRegion,
    },
    {
      label: `3. Select JAR File`,
      description: state[Step.File] ? path.basename(state[Step.File].fsPath) : "Not selected",
      iconPath: new vscode.ThemeIcon(state[Step.File] ? completedIcon : incompleteIcon),
      value: Step.File,
    },
    {
      label: `4. Artifact Name`,
      description: state[Step.ArtifactName] || "Not entered",
      iconPath: new vscode.ThemeIcon(state[Step.ArtifactName] ? completedIcon : incompleteIcon),
      value: Step.ArtifactName,
    },
    {
      label: `5. Description (Optional)`,
      description: state[Step.Description] || "None",
      iconPath: new vscode.ThemeIcon(state[Step.Description] ? completedIcon : incompleteIcon),
      value: Step.Description,
    },
    {
      label: `6. Documentation URL (Optional)`,
      description: state[Step.DocumentationUrl] || "None",
      iconPath: new vscode.ThemeIcon(state[Step.DocumentationUrl] ? completedIcon : incompleteIcon),
      value: Step.DocumentationUrl,
    },
  ];

  // start with the top-level quickpick
  let currentStep: Step | null = null;
  while (true) {
    let selection: { value: Step } | undefined;

    const menuItems = createMenuItems();

    const canComplete =
      state[Step.Environment] &&
      state[Step.CloudRegion] &&
      state[Step.File] &&
      state[Step.ArtifactName];
    // add new item to resolve the top-level quickpick if criteria is met
    if (canComplete) {
      menuItems.push({
        label: "Upload Artifact",
        description: "All required fields provided",
        iconPath: new vscode.ThemeIcon("cloud-upload"),
        value: Step.Complete,
      });
    }

    // top-level quickpick config
    selection = currentStep
      ? { value: currentStep }
      : await vscode.window.showQuickPick(menuItems, {
          title: "Upload Flink Artifact",
          placeHolder: "Select a step to provide details",
          ignoreFocusOut: true,
        });
    if (!selection) {
      return;
    }

    // track if the current step was completed with some kind of value
    let stepCompleted = false;
    // handle interactions at whatever step is chosen
    switch (selection.value) {
      case Step.Environment: {
        const environment = await flinkCcloudEnvironmentQuickPick();
        if (environment) {
          state[Step.Environment] = { id: environment.id, name: environment.name };
          stepCompleted = true;
        }
        break;
      }

      case Step.CloudRegion: {
        const cloudRegion = await cloudProviderRegionQuickPick((region) => region.cloud !== "GCP");
        if (cloudRegion) {
          state[Step.CloudRegion] = {
            provider: cloudRegion.provider,
            region: cloudRegion.region,
          };
          stepCompleted = true;
        }
        break;
      }

      case Step.File: {
        const selectedFiles = await vscode.window.showOpenDialog({
          openLabel: "Select",
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            "Flink Artifact Files": ["jar"],
          },
        });
        if (selectedFiles && selectedFiles.length > 0) {
          state[Step.File] = selectedFiles[0];
          // populate artifact name from filename if not already set
          if (!state[Step.ArtifactName]) {
            state[Step.ArtifactName] = path.basename(
              state[Step.File].fsPath,
              path.extname(state[Step.File].fsPath),
            );
          }
          stepCompleted = true;
        }
        break;
      }

      case Step.ArtifactName: {
        const defaultName = state[Step.File]
          ? path.basename(state[Step.File].fsPath, path.extname(state[Step.File].fsPath))
          : state[Step.ArtifactName] || "";

        const artifactName = await vscode.window.showInputBox({
          title: "Artifact Name",
          prompt: "Enter the artifact name",
          value: defaultName,
          ignoreFocusOut: true,
          validateInput: (value) =>
            value && value.trim() ? undefined : "Artifact name is required",
        });
        if (artifactName !== undefined) {
          state[Step.ArtifactName] = artifactName;
          stepCompleted = true;
        }
        break;
      }

      case Step.Description: {
        const description = await vscode.window.showInputBox({
          title: "Artifact Description",
          prompt: "Enter an optional description for the artifact",
          value: state[Step.Description] || "",
          ignoreFocusOut: true,
        });
        if (description !== undefined) {
          state[Step.Description] = description;
          stepCompleted = true;
        }
        break;
      }

      case Step.DocumentationUrl: {
        const documentationUrl = await vscode.window.showInputBox({
          title: "Documentation URL",
          prompt: "Enter an optional documentation URL for the artifact",
          value: state[Step.DocumentationUrl] || "",
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (value && value.trim()) {
              try {
                new URL(value);
                return undefined;
              } catch {
                return "Please enter a valid URL";
              }
            }
            return undefined;
          },
        });
        if (documentationUrl !== undefined) {
          state[Step.DocumentationUrl] = documentationUrl;
          stepCompleted = true;
        }
        break;
      }

      case Step.Complete: {
        const canComplete =
          state[Step.Environment] &&
          state[Step.CloudRegion] &&
          state[Step.File] &&
          state[Step.ArtifactName];
        if (!canComplete) {
          vscode.window.showErrorMessage("Please complete all required fields before uploading.");
          currentStep = null; // return to top-level quickpick
          continue;
        }

        // convert to CloudProvider enum
        let cloud: CloudProvider;
        if (state[Step.CloudRegion]!.provider === "AZURE") {
          cloud = CloudProvider.Azure;
        } else if (state[Step.CloudRegion]!.provider === "AWS") {
          cloud = CloudProvider.AWS;
        } else {
          void showErrorNotificationWithButtons(
            `Upload Artifact cancelled: Unsupported cloud provider: ${state[Step.CloudRegion]!.provider}`,
          );
          currentStep = null; // return to top-level quickpick
          continue;
        }

        return {
          environment: state[Step.Environment]!.id,
          cloud,
          region: state[Step.CloudRegion]!.region,
          artifactName: state[Step.ArtifactName]!,
          fileFormat: state[Step.File]!.fsPath.split(".").pop() ?? "",
          selectedFile: state[Step.File]!,
        };
      }
    }

    // determine next step based on whether current step was completed
    if (stepCompleted) {
      currentStep = getNextRequiredStep();
    } else if (currentStep) {
      currentStep = null;
    }
  }
}

export async function handleUploadToCloudProvider(
  params: ArtifactUploadParams,
  presignedURL: PresignedUploadUrlArtifactV1PresignedUrl200Response,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Uploading ${params.artifactName}`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Preparing file..." });
      const { blob, contentType } = await prepareUploadFileFromUri(params.selectedFile);

      logger.info(`Starting file upload for cloud provider: ${params.cloud}`, {
        artifactName: params.artifactName,
        environment: params.environment,
        cloud: params.cloud,
        region: params.region,
        contentType,
      });

      switch (params.cloud) {
        case CloudProvider.Azure: {
          progress.report({ message: "Uploading to Azure storage..." });
          logger.debug("Uploading to Azure storage");
          const response = await uploadFileToAzure({
            file: blob,
            presignedUrl: presignedURL.upload_url!,
            contentType,
          });

          logger.info(`Azure upload completed for artifact "${params.artifactName}"`, {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            artifactName: params.artifactName,
            environment: params.environment,
            cloud: params.cloud,
            region: params.region,
          });
          break;
        }
        case CloudProvider.AWS: {
          progress.report({ message: "Uploading to AWS storage..." });
          logger.debug("Uploading to AWS storage");

          const uploadFormData = presignedURL.upload_form_data as Record<string, string>;

          if (!uploadFormData) {
            throw new Error("AWS upload form data is missing from presigned URL response");
          }

          const response = await uploadFileToS3({
            file: blob,
            presignedUrl: presignedURL.upload_url!,
            contentType,
            uploadFormData,
          });

          logger.info(`AWS upload completed for artifact "${params.artifactName}"`, {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            artifactName: params.artifactName,
            environment: params.environment,
            cloud: params.cloud,
            region: params.region,
          });
          break;
        }
      }
    },
  );
}

export async function uploadArtifactToCCloud(
  params: ArtifactUploadParams,
  uploadId: string,
): Promise<CreateArtifactV1FlinkArtifact201Response | undefined> {
  try {
    const createRequest = buildCreateArtifactRequest(params, uploadId);

    logger.info("Creating Flink artifact", {
      artifactName: params.artifactName,
      environment: params.environment,
      cloud: params.cloud,
      region: params.region,
      uploadId,
      requestPayload: createRequest,
    });

    const sidecarHandle = await getSidecar();
    const providerRegion: IEnvProviderRegion = {
      environmentId: params.environment as EnvironmentId,
      provider: params.cloud,
      region: params.region,
    };
    const artifactsClient = sidecarHandle.getFlinkArtifactsApi(providerRegion);

    const response = await artifactsClient.createArtifactV1FlinkArtifact({
      CreateArtifactV1FlinkArtifactRequest: createRequest,
      cloud: params.cloud,
      region: params.region,
    });

    logger.info("Flink artifact created successfully", {
      artifactId: response.id,
      artifactName: params.artifactName,
    });

    artifactUploadCompleted.fire();

    return response;
  } catch (error) {
    let extra: Record<string, unknown> = {
      cloud: params.cloud,
      region: params.region,
    };
    logError(error, "Failed to create Flink artifact in Confluent Cloud", { extra });
    throw error;
  }
}

export function buildCreateArtifactRequest(
  params: ArtifactUploadParams,
  uploadId: string,
): CreateArtifactV1FlinkArtifactRequest {
  return {
    cloud: params.cloud,
    region: params.region,
    environment: params.environment,
    display_name: params.artifactName,
    content_format: params.fileFormat.toUpperCase(),
    upload_source: {
      location: PRESIGNED_URL_LOCATION,
      upload_id: uploadId,
    },
  };
}
