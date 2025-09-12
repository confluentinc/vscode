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
}
