import { Disposable, Uri, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { LocalResourceKind } from "../docker/constants";
import { Logger } from "../logging";
import { runWorkflowWithProgress } from "./docker";

const logger = new Logger("commands.medusaCodeLens");

export const COMMANDS = {
  GENERATE_DATASET: "confluent.medusa.generateDataset",
  START_MEDUSA: "confluent.medusa.start",
} as const;
/**
 * Command handler for generating a Medusa dataset from an Avro schema file.
 */
export async function generateMedusaDatasetCommand(documentUri: Uri): Promise<void> {
  logger.info("Generate Medusa Dataset command triggered", {
    documentUri: documentUri?.toString(),
  });

  // For now, just show an alert
  // TODO: Implement actual Medusa dataset generation logic
  await window.showInformationMessage(
    `Generate Medusa Dataset clicked for: ${documentUri?.fsPath || "Unknown file"}`,
  );
}

/**
 * Command handler for starting the local Medusa container.
 */
export async function startMedusaCommand(): Promise<void> {
  logger.info("Start Medusa command triggered");

  try {
    // Start the Medusa container using the existing workflow
    await runWorkflowWithProgress(true, [LocalResourceKind.Medusa]);
    logger.info("Medusa container start workflow completed");
  } catch (error) {
    logger.error("Failed to start Medusa container:", error);
    await window.showErrorMessage("Failed to start Medusa container. Check the logs for details.");
  }
}

/**
 * Register all Medusa-related commands.
 * @returns Array of disposables for the registered commands
 */
export function registerMedusaCodeLensCommands(): Disposable[] {
  return [
    registerCommandWithLogging(COMMANDS.GENERATE_DATASET, generateMedusaDatasetCommand),
    registerCommandWithLogging(COMMANDS.START_MEDUSA, startMedusaCommand),
  ];
}
