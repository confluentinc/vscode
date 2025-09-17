import * as path from "path";
import { join, parse } from "path";
import { Disposable, Uri, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { DatasetDTO } from "../clients/medusa";
import { Logger } from "../logging";
import { getMedusaSchemaManagementApi } from "../medusa/api";
import { getContainerPublicPort, getMedusaContainer } from "../sidecar/connections/local";
import { getEditorOrFileContents } from "../utils/file";
import { writeFile } from "../utils/fsWrappers";

const logger = new Logger("commands.medusaCodeLens");

export const MEDUSA_COMMANDS = {
  GENERATE_DATASET: "confluent.medusa.generateDataset",
} as const;
/**
 * Command handler for generating a Medusa dataset from an Avro schema file.
 */
export async function generateMedusaDatasetCommand(documentUri: Uri): Promise<void> {
  logger.info("Generate Medusa Dataset command triggered", {
    documentUri: documentUri?.toString(),
  });

  try {
    // Read the Avro schema file contents
    const { content: avroSchemaContent } = await getEditorOrFileContents(documentUri);

    if (!avroSchemaContent.trim()) {
      await window.showErrorMessage("The Avro schema file is empty.");
      return;
    }

    logger.info("Reading Avro schema file", {
      filePath: documentUri.fsPath,
      contentLength: avroSchemaContent.length,
    });

    // Show progress while calling the API
    const dataset = await window.withProgress(
      {
        location: { viewId: "confluent" },
        title: "Generating Medusa Dataset...",
        cancellable: false,
      },
      () => convertAvroSchemaToDataset(avroSchemaContent),
    );

    // Save the dataset to a file
    await saveDatasetToFile(dataset);
  } catch (error) {
    logger.error("Failed to generate Medusa dataset", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    await window.showErrorMessage(`Failed to generate Medusa dataset: ${errorMessage}`);
  }
}

async function convertAvroSchemaToDataset(avroSchemaContent: string): Promise<DatasetDTO> {
  // Parse and validate the Avro schema content
  let parsedSchema;
  try {
    parsedSchema = JSON.parse(avroSchemaContent);
  } catch (parseError) {
    throw new Error(
      `Invalid JSON in Avro schema file: ${parseError instanceof Error ? parseError.message : "Unknown parsing error"}`,
    );
  }

  const medusaContainer = await getMedusaContainer();
  if (!medusaContainer) {
    throw new Error("Medusa container not found. Please start the local Medusa service.");
  }
  const medusaPort = getContainerPublicPort(medusaContainer);
  if (!medusaPort) {
    throw new Error("Medusa container port not accessible. Please check container configuration.");
  }
  logger.info("Calling Medusa API", {
    port: medusaPort,
    schemaType: parsedSchema.type,
    schemaName: parsedSchema.name,
  });

  // Call the Medusa API to convert the Avro schema to dataset
  const medusaApi = getMedusaSchemaManagementApi(medusaPort);
  const dataset = await medusaApi.convertAvroSchemaToDataset({
    body: parsedSchema,
  });

  logger.info("Successfully generated Medusa dataset", {
    eventsCount: dataset.events?.length || 0,
  });

  return dataset;
}

/**
 * Prompts the user to save a DatasetDTO to a file with .dataset.json extension.
 * Defaults to the current workspace directory.
 */
async function saveDatasetToFile(dataset: DatasetDTO): Promise<void> {
  try {
    // Get the workspace folder as default location
    const workspaceFolder = workspace.workspaceFolders?.[0];
    const defaultUri = workspaceFolder ? workspaceFolder.uri : undefined;
    const defaultFilename = `my-dataset.dataset.json`;

    // Show save dialog
    const saveUri = await window.showSaveDialog({
      defaultUri: defaultUri ? Uri.joinPath(defaultUri, defaultFilename) : undefined,
      filters: {
        "Dataset Files": ["dataset.json"],
      },
      saveLabel: "Save Dataset",
    });

    if (!saveUri) {
      // User cancelled the save dialog
      return;
    }

    // Ensure the file has the correct .dataset.json extension
    let finalUri = saveUri;
    const parsed = parse(saveUri.fsPath);
    const nameWithoutAnyExt = parsed.name.split(".")[0];
    finalUri = Uri.file(join(parsed.dir, `${nameWithoutAnyExt}.dataset.json`));

    // Convert dataset to JSON string with pretty formatting
    const datasetJson = JSON.stringify(dataset, null, 2);

    // Write the file
    await writeFile(finalUri, Buffer.from(datasetJson, "utf8"));

    logger.info("Dataset saved successfully", {
      filePath: finalUri.fsPath,
      fileSize: datasetJson.length,
    });

    // Show success message with option to open the file
    const openFile = "Open File";
    const result = await window.showInformationMessage(
      `Dataset saved to ${path.basename(finalUri.fsPath)}`,
      openFile,
    );

    if (result === openFile) {
      await window.showTextDocument(finalUri);
    }
  } catch (error) {
    logger.error("Failed to save dataset file", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    await window.showErrorMessage(`Failed to save dataset file: ${errorMessage}`);
  }
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
