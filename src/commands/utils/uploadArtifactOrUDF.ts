import path from "path";
import * as vscode from "vscode";
import {
  CreateArtifactV1FlinkArtifact201Response,
  CreateArtifactV1FlinkArtifactRequest,
  PresignedUploadUrlArtifactV1PresignedUrl200Response,
  PresignedUploadUrlArtifactV1PresignedUrlRequest,
} from "../../clients/flinkArtifacts";
import { artifactsChanged, udfsChanged } from "../../emitters";
import { logError } from "../../errors";
import { CCloudResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { FlinkArtifact } from "../../models/flinkArtifact";
import { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import { CloudProvider, EnvironmentId, IEnvProviderRegion } from "../../models/resource";
import { showInfoNotificationWithButtons } from "../../notifications";
import { getSidecar } from "../../sidecar";
import { logUsage, UserEvent } from "../../telemetry/events";
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

          logUsage(UserEvent.FlinkArtifactAction, {
            action: "upload",
            status: "succeeded",
            kind: "CloudProviderUpload",
            cloud: params.cloud,
            region: params.region,
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

    logUsage(UserEvent.FlinkArtifactAction, {
      action: "upload",
      status: "succeeded",
      kind: "CCloudUpload",
      cloud: params.cloud,
      region: params.region,
    });

    // Inform all interested parties that we just mutated the artifacts list
    // in this env/region.
    artifactsChanged.fire(providerRegion);

    return response;
  } catch (error) {
    logUsage(UserEvent.FlinkArtifactAction, {
      action: "upload",
      status: "failed",
      kind: "CCloudUpload",
      cloud: params.cloud,
      region: params.region,
    });
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
  await ccloudResourceLoader.executeFlinkStatement<{ created_at?: string }>(
    `CREATE FUNCTION \`${userInput.functionName}\` AS '${userInput.className}' USING JAR 'confluent-artifact://${artifact.id}';`,
    database,
    {
      timeout: 60000, // custom timeout of 60 seconds
    },
  );
  const createdMsg = `${userInput.functionName} function created successfully.`;
  void showInfoNotificationWithButtons(createdMsg);
}

/**
 * Interface representing a class found in a JAR file
 */
export interface JarClassInfo {
  /** The fully qualified class name */
  className: string;
  /** The simple class name (without package) */
  simpleName: string;
}

/**
 * Interface for UDF registration data
 */
export interface UdfRegistrationData {
  /** The class to register as a UDF */
  classInfo: JarClassInfo;
  /** The function name to use for the UDF */
  functionName: string;
}

/**
 * Inspects a JAR file and extracts Java class names using the unzip command.
 * @param jarFileUri The URI of the JAR file to inspect
 * @returns Promise that resolves to an array of class information
 */
export async function inspectJarContents(jarFileUri: vscode.Uri): Promise<JarClassInfo[]> {
  const logger = new Logger("commands/inspectJarContents");

  try {
    // Use a child process to run unzip -l on the JAR file
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const jarPath = jarFileUri.fsPath;
    logger.debug(`Inspecting JAR contents: ${jarPath}`);

    // Run unzip -l to list contents, then filter for .class files
    const { stdout } = await execAsync(`unzip -l "${jarPath}"`);

    // Parse the output to find .class files
    const lines = stdout.split("\n");
    const classFiles: string[] = [];

    for (const line of lines) {
      // Look for lines containing .class files
      const match = line.match(/^\s*\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+\.class)$/);
      if (match) {
        const classPath = match[1];
        // Skip inner classes (containing $) and other non-UDF classes
        if (!classPath.includes("$") && !classPath.includes("META-INF")) {
          classFiles.push(classPath);
        }
      }
    }

    // Convert file paths to class names
    const classInfos: JarClassInfo[] = classFiles.map((filePath) => {
      // Convert path like "com/example/MyUDF.class" to "com.example.MyUDF"
      const className = filePath.replace(/\//g, ".").replace(/\.class$/, "");
      const simpleName = className.split(".").pop() || className;

      return {
        className,
        simpleName,
      };
    });

    logger.debug(`Found ${classInfos.length} class(es) in JAR:`, classInfos);
    return classInfos;
  } catch (error) {
    logger.error("Failed to inspect JAR contents:", error);
    throw new Error(
      `Failed to inspect JAR contents: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Prompts the user to register UDFs after a successful artifact upload.
 * @param artifact The uploaded artifact
 * @param jarFileUri The URI of the original JAR file
 * @param database The Flink database to register UDFs in
 * @returns Promise that resolves when the UDF registration process completes
 */
export async function promptForUdfRegistrationAfterUpload(
  artifact: FlinkArtifact,
  jarFileUri: vscode.Uri,
  database: CCloudFlinkDbKafkaCluster,
): Promise<void> {
  const logger = new Logger("commands/udfRegistrationPrompt");

  try {
    // Ask user if they want to register UDFs
    const registerUdfs = await vscode.window.showInformationMessage(
      `Artifact "${artifact.name}" uploaded successfully! Would you like to register User-Defined Functions (UDFs) from this JAR?`,
      { modal: false },
      "Yes, register UDFs",
      "No, maybe later",
    );

    if (registerUdfs !== "Yes, register UDFs") {
      return;
    }

    logger.debug(`User chose to register UDFs for artifact: ${artifact.name}`);

    // Inspect JAR contents to find classes
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing JAR contents...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Extracting class information from JAR..." });

        const classInfos = await inspectJarContents(jarFileUri);

        if (classInfos.length === 0) {
          void vscode.window.showWarningMessage(
            "No Java classes found in the uploaded JAR file. UDF registration skipped.",
          );
          return;
        }

        progress.report({ message: "Preparing UDF registration options..." });

        // Show class selection to user
        const selectedClasses = await selectClassesForUdfRegistration(classInfos);

        if (!selectedClasses || selectedClasses.length === 0) {
          return; // User cancelled or selected no classes
        }

        // Get function names for selected classes
        const udfRegistrations = await promptForFunctionNames(selectedClasses, artifact);

        if (!udfRegistrations || udfRegistrations.length === 0) {
          return; // User cancelled
        }

        // Register the UDFs
        await registerMultipleUdfs(artifact, udfRegistrations, database);
      },
    );
  } catch (error) {
    logger.error("Error in UDF registration flow:", error);
    void vscode.window.showErrorMessage(
      `Failed to register UDFs: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Shows a quickpick to let the user select which classes to register as UDFs.
 * @param classInfos Array of class information from the JAR
 * @returns Promise that resolves to selected classes or undefined if cancelled
 */
export async function selectClassesForUdfRegistration(
  classInfos: JarClassInfo[],
): Promise<JarClassInfo[] | undefined> {
  const quickPickItems = classInfos.map((classInfo) => ({
    label: classInfo.simpleName,
    description: classInfo.className,
    detail: `Register "${classInfo.simpleName}" as a UDF`,
    classInfo,
  }));

  const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
    title: "Select Classes to Register as UDFs",
    placeHolder: "Choose which classes from the JAR should be registered as User-Defined Functions",
    canPickMany: true,
    ignoreFocusOut: true,
  });

  return selectedItems?.map((item) => item.classInfo);
}

/**
 * Prompts the user for function names for each selected class.
 * @param selectedClasses The classes selected for UDF registration
 * @param artifact The artifact containing the classes
 * @returns Promise that resolves to UDF registration data or undefined if cancelled
 */
export async function promptForFunctionNames(
  selectedClasses: JarClassInfo[],
  artifact: FlinkArtifact,
): Promise<UdfRegistrationData[] | undefined> {
  const registrations: UdfRegistrationData[] = [];
  const functionNameRegex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

  for (const classInfo of selectedClasses) {
    // Generate a default function name based on the simple class name
    const defaultFunctionName = classInfo.simpleName.toLowerCase().replace(/[^a-zA-Z0-9_]/g, "_");

    const functionName = await vscode.window.showInputBox({
      title: `Function Name for ${classInfo.simpleName}`,
      prompt: `Enter the function name for class "${classInfo.className}"`,
      value: defaultFunctionName,
      validateInput: (value) => validateUdfInput(value, functionNameRegex),
      ignoreFocusOut: true,
    });

    if (functionName === undefined) {
      // User cancelled, abort the entire registration process
      return undefined;
    }

    registrations.push({
      classInfo,
      functionName,
    });
  }

  return registrations;
}

/**
 * Registers multiple UDFs from the provided registration data.
 * @param artifact The artifact containing the UDF implementations
 * @param registrations Array of UDF registration data
 * @param database The Flink database to register the UDFs in
 */
export async function registerMultipleUdfs(
  artifact: FlinkArtifact,
  registrations: UdfRegistrationData[],
  database: CCloudFlinkDbKafkaCluster,
): Promise<void> {
  const logger = new Logger("commands/registerMultipleUdfs");
  const ccloudResourceLoader = CCloudResourceLoader.getInstance();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Registering ${registrations.length} UDF(s)`,
      cancellable: false,
    },
    async (progress) => {
      const successfulRegistrations: string[] = [];
      const failedRegistrations: Array<{ functionName: string; error: string }> = [];

      for (let i = 0; i < registrations.length; i++) {
        const registration = registrations[i];
        const progressMessage = `Registering ${registration.functionName} (${i + 1}/${registrations.length})...`;
        progress.report({ message: progressMessage });

        try {
          logger.debug(
            `Registering UDF: ${registration.functionName} -> ${registration.classInfo.className}`,
          );

          await ccloudResourceLoader.executeFlinkStatement(
            `CREATE FUNCTION \`${registration.functionName}\` AS '${registration.classInfo.className}' USING JAR 'confluent-artifact://${artifact.id}';`,
            database,
            {
              timeout: 60000, // 60 second timeout
            },
          );

          successfulRegistrations.push(registration.functionName);

          logUsage(UserEvent.FlinkUDFAction, {
            action: "created",
            status: "succeeded",
            cloud: artifact.provider,
            region: artifact.region,
          });
        } catch (error) {
          logger.error(`Failed to register UDF ${registration.functionName}:`, error);

          let errorMessage = "Unknown error";
          if (error instanceof Error) {
            // Extract meaningful error detail from Flink error messages
            const flinkDetail = error.message.split("Error detail:")[1]?.trim();
            errorMessage = flinkDetail || error.message;
          }

          failedRegistrations.push({
            functionName: registration.functionName,
            error: errorMessage,
          });

          logUsage(UserEvent.FlinkUDFAction, {
            action: "created",
            status: "failed",
            cloud: artifact.provider,
            region: artifact.region,
          });
        }
      }

      // Update the UDFs cache
      progress.report({ message: "Updating UDF cache..." });
      udfsChanged.fire(database);

      // Show results to user
      if (successfulRegistrations.length > 0) {
        const successMessage =
          successfulRegistrations.length === registrations.length
            ? `All ${successfulRegistrations.length} UDF(s) registered successfully!`
            : `${successfulRegistrations.length} of ${registrations.length} UDF(s) registered successfully.`;

        void showInfoNotificationWithButtons(
          `${successMessage} Functions: ${successfulRegistrations.join(", ")}`,
        );
      }

      if (failedRegistrations.length > 0) {
        const errorDetails = failedRegistrations
          .map((f) => `${f.functionName}: ${f.error}`)
          .join("; ");

        void vscode.window.showErrorMessage(
          `Failed to register ${failedRegistrations.length} UDF(s): ${errorDetails}`,
        );
      }
    },
  );
}
