import { Uri, window } from "vscode";
import { Logger } from "../../logging";
import { inspectJarClasses, JarClassInfo } from "../../utils/jarInspector";

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
  } else {
    logger.debug("No Java classes selected.");
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
