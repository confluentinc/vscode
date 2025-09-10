import { Disposable, Uri, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";

const logger = new Logger("commands.medusaCodeLens");

export const MEDUSA_COMMANDS = {
  GENERATE_DATASET: "confluent.medusa.generateDataset",
} as const;
/**
 * Command handler for generating a Medusa dataset from an Avro schema file.
 */
async function generateMedusaDatasetCommand(documentUri: Uri): Promise<void> {
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
 * Register all Medusa-related commands.
 * @returns Array of disposables for the registered commands
 */
export function registerMedusaCodeLensCommands(): Disposable[] {
  return [
    registerCommandWithLogging(MEDUSA_COMMANDS.GENERATE_DATASET, generateMedusaDatasetCommand),
  ];
}
