import path from "path";
import * as vscode from "vscode";
import type {
  CreateArtifactV1FlinkArtifact201Response,
  CreateArtifactV1FlinkArtifactRequest,
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import { artifactsChanged } from "../../emitters";
import { extractResponseBody, isResponseError, logError } from "../../errors";
import { CCloudResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import type { FlinkArtifact } from "../../models/flinkArtifact";
import type { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import type { EnvironmentId, IEnvProviderRegion } from "../../models/resource";
import { CloudProvider } from "../../models/resource";
import { showInfoNotificationWithButtons } from "../../notifications";
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
  description?: string;
  documentationUrl?: string;
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

export async function handleUploadToCloudProvider(
  params: ArtifactUploadParams,
  presignedURL: PresignedUploadUrlArtifactV1PresignedUrl200Response,
): Promise<void> {
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
}

export async function uploadArtifactToCCloud(
  params: ArtifactUploadParams,
  uploadId: string,
): Promise<CreateArtifactV1FlinkArtifact201Response> {
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

    // Inform all interested parties that we just mutated the artifacts list
    // in this env/region.
    artifactsChanged.fire(providerRegion);

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
  const request: CreateArtifactV1FlinkArtifactRequest = {
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
  if (params.description) {
    request.description = params.description;
  }
  if (params.documentationUrl) {
    request.documentation_link = params.documentationUrl;
  }
  return request;
}

export function validateUdfInput(
  input: string,
  regex: RegExp,
): vscode.InputBoxValidationMessage | undefined {
  if (!input || !regex.test(input)) {
    return {
      message:
        "Function name or class name must start with a letter or underscore and contain only letters, numbers, or underscores. Dots are allowed in class names.",
      severity: vscode.InputBoxValidationSeverity.Error,
    };
  }
}
/**
 * Builds a user-presentable error message for an upload failure.
 */
export async function buildUploadErrorMessage(err: unknown, base: string): Promise<string> {
  let errorMessage = base;
  if (isResponseError(err)) {
    if (err.response.status === 500) {
      errorMessage = `${errorMessage} Please make sure that you provided a valid JAR file`;
    } else {
      const resp = await extractResponseBody(err);
      try {
        errorMessage = `${errorMessage} ${resp?.errors?.[0]?.detail}`;
      } catch {
        errorMessage = `${errorMessage} ${typeof resp === "string" ? resp : JSON.stringify(resp)}`;
      }
    }
  } else if (err instanceof Error) {
    errorMessage = `${errorMessage} ${err.message}`;
  }
  return errorMessage;
}

/**
 * This function prompts the user for a function name and class name for a new UDF.
 * It returns an object containing the function name and class name, or undefined if the user cancels.
 *
 * @param selectedArtifact The selected Flink artifact, used to generate a default function name.
 */
export async function promptForFunctionAndClassName(
  selectedArtifact: FlinkArtifact | undefined,
): Promise<{ functionName: string; className: string } | undefined> {
  const defaultFunctionName = `udf_${selectedArtifact?.name?.substring(0, 6) ?? ""}`;
  const functionNameRegex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
  const classNameRegex = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
  const functionName = await vscode.window.showInputBox({
    prompt: "Enter a name for the new UDF",
    placeHolder: defaultFunctionName,
    validateInput: (value) => validateUdfInput(value, functionNameRegex),
    ignoreFocusOut: true,
  });

  if (functionName === undefined) {
    return undefined;
  }

  const className = await vscode.window.showInputBox({
    prompt: 'Enter the fully qualified class name, e.g. "com.example.MyUDF"',
    placeHolder: `your.package.ClassName`,
    validateInput: (value) => validateUdfInput(value, classNameRegex),
    ignoreFocusOut: true,
  });
  if (className === undefined) {
    return undefined;
  }
  return { functionName, className };
}

/**
 * Submit a `CREATE FUNCTION` statement to register a UDF for the provided artifact, function and
 * class names defined by the user, and Flink database.
 */
export async function executeCreateFunction(
  artifact: FlinkArtifact,
  userInput: {
    functionName: string;
    className: string;
  },
  database: CCloudFlinkDbKafkaCluster,
) {
  const ccloudResourceLoader = CCloudResourceLoader.getInstance();
  await ccloudResourceLoader.executeBackgroundFlinkStatement<{ created_at?: string }>(
    `CREATE FUNCTION \`${userInput.functionName}\` AS '${userInput.className}' USING JAR 'confluent-artifact://${artifact.id}';`,
    database,
    {
      timeout: 60000, // custom timeout of 60 seconds
    },
  );
  const createdMsg = `${userInput.functionName} function created successfully.`;
  void showInfoNotificationWithButtons(createdMsg);
}
