import { ProgressLocation, Uri, window } from "vscode";
import { udfsChanged } from "../../emitters";
import { CCloudResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { showInfoNotificationWithButtons } from "../../notifications";
import { logUsage, UserEvent } from "../../telemetry/events";
import { inspectJarClasses, JarClassInfo } from "../../utils/jarInspector";
import { FlinkDatabaseViewProvider } from "../../viewProviders/flinkDatabase";
import { validateUdfInput } from "./uploadArtifactOrUDF";

const logger = new Logger("commands.flinkUDFs/udfRegistration");

export async function detectClassesAndRegisterUDFs(params: { selectedFile: Uri }) {
  const classNames = await inspectJarClasses(params.selectedFile);
  if (classNames && classNames.length > 0) {
    logger.debug(`Found ${classNames.length} classes in the JAR file.`);

    const selectedClasses = await selectClassesForUdfRegistration(classNames);
    if (!selectedClasses || selectedClasses.length === 0) {
      return; // User cancelled or selected no classes
    }
    logger.debug(`User selected ${selectedClasses.length} classes for UDF registration.`);
    const registrations = await promptForFunctionNames(selectedClasses);
    if (!registrations || registrations.length === 0) {
      return; // User cancelled or provided no function names
    }
    logger.debug(`User provided ${registrations.length} function names.`);
  } else {
    logger.debug("No Java classes found in JAR file.");
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
    placeHolder: "Choose which classes from the JAR should be registered as User-Defined Functions",
    canPickMany: true,
    ignoreFocusOut: true,
  });

  return selectedItems?.map((item) => item.classInfo);
}
export interface UdfRegistrationData {
  /** The class to register as a UDF */
  classInfo: JarClassInfo;
  /** The function name to use for the UDF */
  functionName: string;
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
 * Registers multiple UDFs from the provided registration data.
 * @param artifact The artifact containing the UDF implementations
 * @param registrations Array of UDF registration data
 */
export async function registerMultipleUdfs(
  registrations: UdfRegistrationData[],
  artifactId?: string,
) {
  if (!artifactId) {
    throw new Error("Artifact ID is required to register UDFs.");
  }
  const ccloudResourceLoader = CCloudResourceLoader.getInstance();
  const selectedFlinkDatabase = FlinkDatabaseViewProvider.getInstance().database;
  if (!selectedFlinkDatabase) {
    // FIXME NC handle this case - allow DB selection? since this flow can be started outside of Flink DB view
    throw new Error("No Flink database selected.");
  }
  if (registrations.length === 0) {
    throw new Error("No UDF registrations to process.");
  }
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
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

          await ccloudResourceLoader.executeBackgroundFlinkStatement(
            `CREATE FUNCTION \`${registration.functionName}\` AS '${registration.classInfo.className}' USING JAR 'confluent-artifact://${artifactId}';`,
            selectedFlinkDatabase,
            {
              timeout: 60000, // 60 second timeout
            },
          );
          successfulRegistrations.push(registration.functionName);

          logUsage(UserEvent.FlinkUDFAction, {
            action: "created",
            status: "succeeded",
            cloud: selectedFlinkDatabase.provider,
            region: selectedFlinkDatabase.region,
          });
        } catch (error) {
          logger.error(`Failed to register UDF ${registration.functionName}:`, error);

          let errorMessage = "Unknown error";
          if (error instanceof Error) {
            // FIXME NC verify/update this AI suggestion for error handling
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
            cloud: selectedFlinkDatabase.provider,
            region: selectedFlinkDatabase.region,
          });
        }
      }

      // Update the UDFs list in cache and refresh view
      progress.report({ message: "Updating UDF view" });
      udfsChanged.fire(selectedFlinkDatabase);

      // Show summary notification(s) to user
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

        void window.showErrorMessage(
          `Failed to register ${failedRegistrations.length} UDF(s): ${errorDetails}`,
        );
      }
    },
  );
}
