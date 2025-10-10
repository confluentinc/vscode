import { Uri, window } from "vscode";
import { Logger } from "../../logging";
import { inspectJarClasses, JarClassInfo } from "../../utils/jarInspector";
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
/**
 * Prompts the user for function names for each selected class.
 * @param selectedClasses The classes selected for UDF registration
 * @returns Promise that resolves to UDF registration data or undefined if cancelled
 */
export async function promptForFunctionNames(
  selectedClasses: JarClassInfo[],
): Promise<{ classInfo: JarClassInfo; functionName: string }[] | undefined> {
  const registrations: { classInfo: JarClassInfo; functionName: string }[] = [];
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
