import {
  CodeLens,
  CodeLensProvider,
  Command,
  Disposable,
  Event,
  EventEmitter,
  Position,
  Range,
  TextDocument,
} from "vscode";
import { COMMANDS } from "../commands/medusaCodeLens";
import { localMedusaConnected } from "../emitters";
import { ENABLE_MEDUSA_CONTAINER } from "../extensionSettings/constants";
import { Logger } from "../logging";
import { DisposableCollection } from "../utils/disposables";

const logger = new Logger("codelens.avroProvider");

export class AvroCodelensProvider extends DisposableCollection implements CodeLensProvider {
  // controls refreshing the available codelenses
  private _onDidChangeCodeLenses: EventEmitter<void> = new EventEmitter<void>();
  readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

  private static instance: AvroCodelensProvider | null = null;
  private medusaAvailable: boolean = false;

  static getInstance(): AvroCodelensProvider {
    if (!AvroCodelensProvider.instance) {
      AvroCodelensProvider.instance = new AvroCodelensProvider();
    }
    return AvroCodelensProvider.instance;
  }

  private constructor() {
    super();

    this.disposables.push(...this.setEventListeners());
  }

  protected setEventListeners(): Disposable[] {
    return [localMedusaConnected.event(this.medusaConnectedHandler.bind(this))];
  }

  /**
   * Refresh/update all codelenses for documents visible in the workspace when localMedusaConnected event fires.
   * @param connected - whether the Medusa container is available
   */
  medusaConnectedHandler(connected: boolean): void {
    logger.debug("medusaConnectedHandler called, updating codelenses", { connected });
    this.medusaAvailable = connected;
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const codeLenses: CodeLens[] = [];

    // Check if Medusa container feature is enabled in settings
    if (!ENABLE_MEDUSA_CONTAINER.value) {
      return [];
    }

    // Only show CodeLens if this is actually an Avro document
    if (!this.isAvroDocument(document)) {
      return [];
    }

    // Show code lens at the top of the file
    const range = new Range(new Position(0, 0), new Position(0, 0));

    if (this.medusaAvailable) {
      // Medusa is running - show the dataset generation option
      const generateDatasetCommand: Command = {
        title: "Generate Medusa Dataset",
        command: COMMANDS.GENERATE_DATASET,
        tooltip: "Generate a Medusa dataset from this Avro schema file",
        arguments: [document.uri],
      };

      const generateDatasetLens = new CodeLens(range, generateDatasetCommand);
      codeLenses.push(generateDatasetLens);
    } else {
      // Medusa is not running - show the start option
      const startMedusaCommand: Command = {
        title: "Start Local Medusa",
        command: COMMANDS.START_MEDUSA,
        tooltip: "Start the local Medusa container",
        arguments: [],
      };

      const startMedusaLens = new CodeLens(range, startMedusaCommand);
      codeLenses.push(startMedusaLens);
    }

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
