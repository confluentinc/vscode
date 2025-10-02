import { Disposable, EventEmitter, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import {
  flinkStatementSearchSet,
  resourceSearchSet,
  schemaSearchSet,
  topicSearchSet,
} from "../emitters";
import { Logger } from "../logging";

const logger = new Logger("commands.search");

/**
 * Class used for implementing the commands to search or clear search for a searchable view.
 * Binds together the the logging label noun, view name (for command name interpolation),
 * context value describing wether search has been applied or not, and the emitter holding the
 * chosen search critera for a single view
 *
 * Provides command implementations and registration.
 * */
export class ViewSearchCommands {
  labelNoun: string;
  viewName: string;
  searchContextValue: ContextValues;
  emitter: EventEmitter<string | null>;

  constructor(
    labelNoun: string,
    viewName: string,
    searchContextValue: ContextValues,
    emitter: EventEmitter<string | null>,
  ) {
    this.labelNoun = labelNoun;
    this.viewName = viewName;
    this.searchContextValue = searchContextValue;
    this.emitter = emitter;
  }

  /**
   * Command implementation to search this view.
   * @returns Promise that resolves when the search string has been set and the emitter fired.
   */
  async searchCommand(): Promise<void> {
    const searchString = await window.showInputBox({
      title: `Search items in the ${this.labelNoun} view`,
      ignoreFocusOut: true,
    });
    if (!searchString) {
      return;
    }
    await setContextValue(this.searchContextValue, true);
    logger.debug(`Searching ${this.labelNoun}`);
    this.emitter.fire(searchString);
  }

  /**
   * Command implementation to clear the search string for this view.
   * @returns Promise that resolves when the search string has been cleared and the emitter fired.
   */
  async clearCommand(): Promise<void> {
    logger.debug(`Clearing ${this.labelNoun} search`);
    await setContextValue(this.searchContextValue, false);
    this.emitter.fire(null);
  }

  registerCommands(): Disposable[] {
    return [
      registerCommandWithLogging(
        `confluent.${this.viewName}.search`,
        this.searchCommand.bind(this),
      ),
      registerCommandWithLogging(
        `confluent.${this.viewName}.search.clear`,
        this.clearCommand.bind(this),
      ),
    ];
  }
}

/** Instance to assist in searching the resources view */
export const searchResourcesViewCommands = new ViewSearchCommands(
  "Resources",
  "resources",
  ContextValues.resourceSearchApplied,
  resourceSearchSet,
);

/** Instance to assist in searching the topics view */
export const searchTopicsViewCommands = new ViewSearchCommands(
  "Topics",
  "topics",
  ContextValues.topicSearchApplied,
  topicSearchSet,
);

/** Instance to assist in searching the topics view */
export const searchSchemasViewCommands = new ViewSearchCommands(
  "Schemas",
  "schemas",
  ContextValues.schemaSearchApplied,
  schemaSearchSet,
);

/** Instance to assist in searching the topics view */
export const searchFlinkStatementsViewCommands = new ViewSearchCommands(
  "Flink Statements",
  "flink.statements",
  ContextValues.flinkStatementsSearchApplied,
  flinkStatementSearchSet,
);

/** Register the search + clear commands for each searchable view. */
export function registerSearchCommands(): Disposable[] {
  return [
    ...searchResourcesViewCommands.registerCommands(),
    ...searchTopicsViewCommands.registerCommands(),
    ...searchSchemasViewCommands.registerCommands(),
    ...searchFlinkStatementsViewCommands.registerCommands(),
  ];
}
