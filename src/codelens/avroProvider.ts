import { CodeLens, CodeLensProvider, Command, Position, Range, TextDocument } from "vscode";
import { MEDUSA_COMMANDS } from "../commands/medusaCodeLens";
import { ENABLE_MEDUSA_CONTAINER } from "../extensionSettings/constants";
import { Logger } from "../logging";
import { DisposableCollection } from "../utils/disposables";

const logger = new Logger("codelens.avroProvider");

export class AvroCodelensProvider extends DisposableCollection implements CodeLensProvider {
  private static instance: AvroCodelensProvider | null = null;

  static getInstance(): AvroCodelensProvider {
    if (!AvroCodelensProvider.instance) {
      AvroCodelensProvider.instance = new AvroCodelensProvider();
    }
    return AvroCodelensProvider.instance;
  }

  private constructor() {
    super();
  }

  async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const codeLenses: CodeLens[] = [];
    if (!ENABLE_MEDUSA_CONTAINER.value) {
      return [];
    }

    // Only show CodeLens if this is actually an Avro document
    if (!this.isAvroDocument(document)) {
      return [];
    }

    // Show code lens at the top of the file
    const range = new Range(new Position(0, 0), new Position(0, 0));

    const generateDatasetCommand: Command = {
      title: "Generate Medusa Dataset",
      command: MEDUSA_COMMANDS.GENERATE_DATASET,
      tooltip: "Generate a Medusa dataset from this Avro schema file",
      arguments: [document.uri],
    };

    const generateDatasetLens = new CodeLens(range, generateDatasetCommand);
    codeLenses.push(generateDatasetLens);

    logger.info("AvroCodelensProvider returning code lenses", { count: codeLenses.length });
    return codeLenses;
  }

  private isAvroDocument(document: TextDocument): boolean {
    // For .avsc files, always show (regardless of language mode)
    if (document.uri?.fsPath?.endsWith(".avsc")) {
      return true;
    }

    // For non-.avsc files, only show if language is avroavsc OR has a valid "type" field
    if (document.languageId === "avroavsc") {
      return true;
    }

    try {
      const content = document.getText();
      const parsed = JSON.parse(content);

      // Check if it has a type field and it's a valid Avro type
      if (parsed && typeof parsed.type === "string") {
        const avroTypes = [
          "null",
          "boolean",
          "int",
          "long",
          "float",
          "double",
          "bytes",
          "string",
          "record",
          "enum",
          "array",
          "map",
          "union",
          "fixed",
        ];
        return avroTypes.includes(parsed.type);
      }

      return false;
    } catch {
      return false;
    }
  }
}
