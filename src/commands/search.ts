import type { Disposable, EventEmitter } from "vscode";
import { window } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { schemaSearchSet, topicSearchSet } from "../emitters";
import { Logger } from "../logging";
import type { BaseViewProvider } from "../viewProviders/baseModels/base";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";
import { ResourceViewProvider } from "../viewProviders/resources";

const logger = new Logger("commands.search");

/*
  When creating a new searchable view, define a new instance of ViewSearchCommands
  and add it to the getAllSearchCommandsInstances array below.

  Then touch up search.test.ts to verify the commands are registered correctly.
*/

/**
 * Class used for implementing the commands to search or clear search for a searchable view.
 * Binds together the the logging label noun, view name (for command name interpolation),
 * context value describing whether search has been applied or not, and the emitter holding the
 * chosen search criteria for a single view
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

export class BaseViewProviderSearchableCommands<
  V extends BaseViewProvider<any>,
> extends ViewSearchCommands {
  constructor(view: V, labelNoun: string, viewName: string) {
    super(labelNoun, viewName, view.searchContextValue!, view.searchChangedEmitter!);
  }
}

/**
 * Return all of the ViewSearchCommands instances. Can only be
 * called after setExtensionContext() has been called, so that
 * the referenced view providers have been initialized.
 */
export function getAllSearchCommandsInstances(): ViewSearchCommands[] {
  return [
    // Instance to assist in searching the Resources view
    new BaseViewProviderSearchableCommands(
      ResourceViewProvider.getInstance(),
      "Resources",
      "resources",
    ),

    // Instance to assist in searching the Topics view
    new ViewSearchCommands("Topics", "topics", ContextValues.topicSearchApplied, topicSearchSet),

    // Instance to assist in searching the Schemas view
    new ViewSearchCommands(
      "Schemas",
      "schemas",
      ContextValues.schemaSearchApplied,
      schemaSearchSet,
    ),

    // Instance to assist in searching the Flink Statements view
    new BaseViewProviderSearchableCommands(
      FlinkStatementsViewProvider.getInstance(),
      "Flink Statements",
      "flink.statements",
    ),

    // Instance for the Flink Database view
    new BaseViewProviderSearchableCommands(
      FlinkDatabaseViewProvider.getInstance(),
      "Flink Database",
      "flink.database",
    ),
  ];
}

/** Register the search + clear commands for each searchable view. */
export function registerSearchCommands(): Disposable[] {
  return getAllSearchCommandsInstances().flatMap((instance) => instance.registerCommands());
}
