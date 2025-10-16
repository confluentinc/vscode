import { ProgressLocation, Uri, window } from "vscode";
import { udfsChanged } from "../../emitters";
import { logError } from "../../errors";
import { CCloudResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { CCloudFlinkDbKafkaCluster } from "../../models/kafkaCluster";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../../notifications";
import { flinkDatabaseQuickpick } from "../../quickpicks/kafkaClusters";
import { logUsage, UserEvent } from "../../telemetry/events";
import { inspectJarClasses, JarClassInfo } from "../../utils/jarInspector";
import { FlinkDatabaseViewProvider } from "../../viewProviders/flinkDatabase";
import { validateUdfInput } from "./uploadArtifactOrUDF";

const logger = new Logger("commands.utils.udfRegistration");
export interface UdfRegistrationData {
  /** The class to register as a UDF */
  classInfo: JarClassInfo;
  /** The function name to use for the UDF */
  functionName: string;
}
// internal for ease of passing it down a level
export interface ProgressReporter {
  report(value: { message?: string; increment?: number }): void;
}

// internal for reuse in multiple functions along the way
export interface RegistrationResults {
  successes: string[];
  failures: Array<{ functionName: string; error: string }>;
}

/**
 * Detects classes in the selected JAR file, prompts the user to select classes & provide function names,
 * and calls the appropriate methods to register each one as a UDF.
 * @param artifactFile The selected JAR file URI
 * @param artifactId The artifact ID where the UDFs originate
 */
export async function detectClassesAndRegisterUDFs(artifactFile: Uri, artifactId?: string) {
  logUsage(UserEvent.FlinkUDFAction, {
    action: "created",
    status: "started",
    kind: "quick-register",
  });
  try {
    if (!artifactId) {
      logger.error("Could not auto-register UDFs, no artifact ID provided in upload response.");
      throw new Error("Unable to find artifact ID");
    }

    const classNames = await inspectJarClasses(artifactFile);
    if (!classNames || classNames.length === 0) {
      logger.debug("No Java classes found in JAR file.");
      throw new Error("No Java classes found in the selected JAR file.");
    }
    logger.trace(`Found ${classNames.length} classes in the JAR file.`);

    const selectedClasses = await selectClassesForUdfRegistration(classNames);
    if (!selectedClasses || selectedClasses.length === 0) {
      logUsage(UserEvent.FlinkUDFAction, {
        action: "created",
        status: "exited",
        kind: "quick-register",
        step: "select classes",
      });
      return; // No error - user cancelled quickpick or selected 0 classes
    }
    logger.trace(`User selected ${selectedClasses.length} classes for UDF registration.`);

    const registrations = await promptForFunctionNames(selectedClasses);
    if (!registrations || registrations.length === 0) {
      logUsage(UserEvent.FlinkUDFAction, {
        action: "created",
        status: "exited",
        kind: "quick-register",
        step: "provide function names",
      });
      return; // No error - user cancelled or provided no function names
    }
    logger.trace(`Prepared ${registrations.length} UDF registration(s).`);

    const results = await registerMultipleUdfs(registrations, artifactId);
    reportRegistrationResults(registrations.length, results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unknown error occurred";
    logError(error, "UDF quick-register workflow failed", {
      extra: {
        artifactId,
      },
    });
    logUsage(UserEvent.FlinkUDFAction, {
      action: "created",
      status: "failed",
      kind: "quick-register",
      step: "exception thrown",
    });
    void showErrorNotificationWithButtons(
      `Failed to register UDF(s): ${message}. Try again by right-clicking the artifact from the list in the Flink Database Explorer view.`,
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
    classInfo,
  }));

  const selectedItems = await window.showQuickPick(quickPickItems, {
    title: "Select Classes to Register as UDFs",
    placeHolder: "Select classes to register as UDFs",
    canPickMany: true,
    ignoreFocusOut: true,
  });

  return selectedItems?.map((item) => item.classInfo);
}
/**
 * Prompts the user for function names for each selected class.
 * @param selectedClasses The classes selected for UDF registration
 * @returns Promise that resolves to UDF registration data or undefined if cancelled
 */
export async function promptForFunctionNames(
  selectedClasses: JarClassInfo[],
): Promise<UdfRegistrationData[] | undefined> {
  const registrations: UdfRegistrationData[] = [];
  const functionNameRegex = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

  for (const classInfo of selectedClasses) {
    // Generate a default function name based on the simple class name
    let defaultFunctionName = classInfo.simpleName.toLowerCase().replace(/\W/g, "_");

    const functionName = await window.showInputBox({
      title: `Function Name for ${classInfo.simpleName}`,
      prompt: `Enter a function name for class "${classInfo.className}"`,
      value: defaultFunctionName,
      validateInput: (value) => validateUdfInput(value, functionNameRegex),
      ignoreFocusOut: true,
    });

    if (functionName === undefined) {
      // User cancelled name input; continue to other classes but don't push undefined name to registrations
      continue;
    } else {
      registrations.push({
        classInfo,
        functionName: functionName.trim(),
      });
    }
  }
  return registrations;
}

/**
 * Registers multiple UDFs from the provided registration data & selected Flink database
 * Opens a progress notification during the process and displays progress updates from inner `executeUdfRegistrations`
 * @param artifact The artifact containing the UDF implementations
 * @param registrations Array of UDF registration information
 * @returns RegistrationResults containing successes and failures
 */
export async function registerMultipleUdfs(
  registrations: UdfRegistrationData[],
  artifactId: string,
): Promise<RegistrationResults> {
  let selectedFlinkDatabase = FlinkDatabaseViewProvider.getInstance().database || undefined;
  if (!selectedFlinkDatabase) {
    selectedFlinkDatabase = await flinkDatabaseQuickpick(
      undefined,
      "Select the Flink database (Kafka cluster) where you want to register the UDFs",
    );
    if (!selectedFlinkDatabase) {
      throw new Error("No Flink database selected.");
    }
  }

  return await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Registering ${registrations.length} UDF(s)`,
      cancellable: false,
    },
    async (progress) => {
      return await executeUdfRegistrations(
        registrations,
        artifactId,
        selectedFlinkDatabase,
        progress,
      );
    },
  );
}

/**
 * Executes the UDF registration statement for each UDF in sequence
 * Reports progress to parent `window.withProgress`
 * @returns RegistrationResults containing successes and failures
 */
export async function executeUdfRegistrations(
  registrations: UdfRegistrationData[],
  artifactId: string,
  selectedFlinkDatabase: CCloudFlinkDbKafkaCluster,
  progress: ProgressReporter,
): Promise<RegistrationResults> {
  const ccloudResourceLoader = CCloudResourceLoader.getInstance();

  const successes: string[] = [];
  const failures: Array<{ functionName: string; error: string }> = [];

  for (let i = 0; i < registrations.length; i++) {
    const registration = registrations[i];
    progress.report({
      message: `Registering ${registration.functionName} (${i + 1}/${registrations.length})...`,
    });

    try {
      logger.debug(
        `Registering UDF: ${registration.functionName} -> ${registration.classInfo.className}`,
      );

      await ccloudResourceLoader.executeBackgroundFlinkStatement(
        `CREATE FUNCTION \`${registration.functionName}\` AS '${registration.classInfo.className}' USING JAR 'confluent-artifact://${artifactId}';`,
        selectedFlinkDatabase,
        {
          timeout: 60000,
        },
      );
      successes.push(registration.functionName);

      logUsage(UserEvent.FlinkUDFAction, {
        action: "created",
        status: "succeeded",
        kind: "quick-register",
        cloud: selectedFlinkDatabase.provider,
        region: selectedFlinkDatabase.region,
      });
    } catch (error) {
      logger.error(`Failed to register UDF ${registration.functionName}:`, error);

      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        const flinkDetail = error.message.split("Error detail:")[1]?.trim();
        errorMessage = flinkDetail || error.message;
      }

      failures.push({
        functionName: registration.functionName,
        error: errorMessage,
      });

      logUsage(UserEvent.FlinkUDFAction, {
        action: "created",
        status: "failed",
        kind: "quick-register",
        cloud: selectedFlinkDatabase.provider,
        region: selectedFlinkDatabase.region,
      });
    }
  }

  progress.report({ message: "Updating UDF view" });
  udfsChanged.fire(selectedFlinkDatabase);
  return { successes, failures };
}

/** Takes success/failure reports from registration, formats messaging, & sends to the user via notifications
 * @param requestedCount The total number of UDFs user selected for registration
 * @param successes Array of successfully registered function names
 * @param failures Array of failures with function names and error messages
 */
export function reportRegistrationResults(
  requestedCount: number,
  { successes, failures }: RegistrationResults,
) {
  if (successes.length > 0) {
    const allSuccessful = successes.length === requestedCount;
    let successMessage;
    if (allSuccessful) {
      if (requestedCount === 1) {
        successMessage = `UDF registered successfully!`;
      } else successMessage = `All ${successes.length} UDF(s) registered successfully!`;
    } else {
      successMessage = `${successes.length} of ${requestedCount} UDF(s) registered successfully.`;
    }
    void showInfoNotificationWithButtons(`${successMessage} Functions: ${successes.join(", ")}`);
  }

  if (failures.length > 0) {
    const errorDetails = failures.map((f) => `${f.functionName}: ${f.error}`).join("; ");
    void window.showErrorMessage(`Failed to register ${failures.length} UDF(s): ${errorDetails}`);
  }
}
