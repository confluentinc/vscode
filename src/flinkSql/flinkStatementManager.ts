import { ConfigurationChangeEvent, Disposable, WorkspaceConfiguration, workspace } from "vscode";
import { flinkStatementDeleted, flinkStatementUpdated } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { FlinkStatement, FlinkStatementId } from "../models/flinkStatement";
import {
  DEFAULT_STATEMENT_POLLING_CONCURRENCY,
  DEFAULT_STATEMENT_POLLING_FREQUENCY,
  DEFAULT_STATEMENT_POLLING_LIMIT,
  STATEMENT_POLLING_CONCURRENCY,
  STATEMENT_POLLING_FREQUENCY,
  STATEMENT_POLLING_LIMIT,
} from "../preferences/constants";
import { IntervalPoller } from "../utils/timing";

const logger = new Logger("FlinkStatementManager");

export type FlinkStatementManagerConfiguration = {
  /** The frequency at which to poll for updated statements (in seconds. 0 = no polling at all). */
  pollingFrequency: number;
  maxStatementsToPoll: number;
  concurrency: number;
};

/**
 * Singleton class to manage Flink statements.
 * This class is responsible for registering and periodically updating
 * non-terminal-state Flink statements on behalf of one or more in-codebase clients
 * (namely the FlinkStatementsViewProvider and any open Flink statement results webviews).
 *
 * Emits an event onto `flinkStatementUpdated` whenever a nonterminal statement is updated, and
 * an event onto `flinkStatementDeleted` whenever a nonterminal statement is deleted.
 * */
export class FlinkStatementManager {
  private static instance: FlinkStatementManager | undefined = undefined;

  static getInstance(): FlinkStatementManager {
    if (!FlinkStatementManager.instance) {
      FlinkStatementManager.instance = new FlinkStatementManager();
    }
    return FlinkStatementManager.instance;
  }

  static getConfiguration(): FlinkStatementManagerConfiguration {
    const configs: WorkspaceConfiguration = workspace.getConfiguration();
    let concurrency =
      configs.get<number>(STATEMENT_POLLING_CONCURRENCY) ?? DEFAULT_STATEMENT_POLLING_CONCURRENCY;
    let pollingFrequency =
      configs.get<number>(STATEMENT_POLLING_FREQUENCY) ?? DEFAULT_STATEMENT_POLLING_FREQUENCY;
    let maxStatementsToPoll =
      configs.get<number>(STATEMENT_POLLING_LIMIT) ?? DEFAULT_STATEMENT_POLLING_LIMIT;

    if (concurrency < 1) {
      logger.error(
        `Invalid concurrency: ${concurrency}. Resetting to ${DEFAULT_STATEMENT_POLLING_CONCURRENCY}.`,
      );
      concurrency = DEFAULT_STATEMENT_POLLING_CONCURRENCY;
    }

    if (pollingFrequency < 0) {
      logger.error(
        `Invalid polling frequency: ${pollingFrequency}. Resetting to ${DEFAULT_STATEMENT_POLLING_FREQUENCY}.`,
      );
      pollingFrequency = DEFAULT_STATEMENT_POLLING_FREQUENCY;
    }

    if (maxStatementsToPoll < 1) {
      logger.error(
        `Invalid max statement to poll: ${maxStatementsToPoll}. Resetting to ${DEFAULT_STATEMENT_POLLING_LIMIT}.`,
      );
      maxStatementsToPoll = DEFAULT_STATEMENT_POLLING_LIMIT;
    }
    return {
      concurrency,
      pollingFrequency,
      maxStatementsToPoll,
    };
  }

  private poller: IntervalPoller | undefined;
  private monitoredStatements: MonitoredStatements = new MonitoredStatements();
  private isPolling: boolean = false;
  private configuration: FlinkStatementManagerConfiguration;
  disposables: Disposable[] = [];

  /** Should we poll at all based on configuration? */
  isEnabled(): boolean {
    return this.configuration.pollingFrequency > 0;
  }

  /** Should we poll eventually / have a poller defined? */
  shouldPoll(): boolean {
    return this.isEnabled() && !this.monitoredStatements.isEmpty();
  }

  private constructor() {
    this.configuration = FlinkStatementManager.getConfiguration();
    // May be undefined if polling is disabled.
    this.poller = this.resetPoller();
    // Listen for changes to our configuration.
    this.disposables.push(this.createConfigChangeListener());
  }

  /**
   * Construct a new poller with the current configured frequency
   * if user has enabled polling.
   * If the poller is already running, stop it first.
   * If settings are configured to disable polling, return undefined.
   * @returns The new poller, or undefined if polling is disabled.
   */
  private resetPoller(): IntervalPoller | undefined {
    if (this.poller && this.poller.isRunning()) {
      // Stop existing poller if it is running.
      logger.debug("Stopping existing poller");
      this.poller.stop();
    }

    if (this.isEnabled()) {
      logger.debug(
        `Polling is enabled, creating new poller with frequency ${this.configuration.pollingFrequency}`,
      );
      // Create a new poller with the current frequency.
      const poller = new IntervalPoller(
        "FlinkStatementManager",
        async () => {
          if (!this.isPolling) {
            await this.pollStatements();
          }
        },
        this.configuration.pollingFrequency * 1000,
      );

      // Start the new poller if we have statements to poll.
      if (this.shouldPoll()) {
        logger.debug("Starting new poller since we should be polling");
        poller.start();
      }

      return poller;
    } else {
      // No polling needed.
      logger.debug("Polling is disabled, not constructing poller");
      return undefined;
    }
  }

  private createConfigChangeListener(): Disposable {
    // NOTE: this fires from any VS Code configuration, not just configs from our extension
    const disposable: Disposable = workspace.onDidChangeConfiguration(
      async (event: ConfigurationChangeEvent) => {
        // get the latest workspace configs after the event fired
        const workspaceConfigs: WorkspaceConfiguration = workspace.getConfiguration();

        if (event.affectsConfiguration(STATEMENT_POLLING_FREQUENCY)) {
          const newFrequency = workspaceConfigs.get<number>(STATEMENT_POLLING_FREQUENCY);
          if (newFrequency === undefined) {
            logger.error(`Invalid polling frequency: ${newFrequency}`);
            return;
          }
          this.configuration.pollingFrequency = newFrequency;
          logger.debug(`Polling frequency changed to ${newFrequency}`);
          this.poller = this.resetPoller();
          return;
        }

        if (event.affectsConfiguration(STATEMENT_POLLING_LIMIT)) {
          const newLimit = workspaceConfigs.get<number>(STATEMENT_POLLING_LIMIT);
          if (newLimit === undefined) {
            logger.error(`Invalid max statement to poll: ${newLimit}`);
            return;
          }
          this.configuration.maxStatementsToPoll = newLimit;
          logger.debug(`Max statement to poll changed to ${newLimit}`);
          return;
        }

        if (event.affectsConfiguration(STATEMENT_POLLING_CONCURRENCY)) {
          const newConcurrency = workspaceConfigs.get<number>(STATEMENT_POLLING_CONCURRENCY);
          if (newConcurrency === undefined) {
            logger.error(`Invalid concurrency: ${newConcurrency}`);
            return;
          }
          this.configuration.concurrency = newConcurrency;
          logger.debug(`Polling concurrency changed to ${newConcurrency}`);
          return;
        }
      },
    );

    return disposable;
  }

  // XXX todo ccloud auth listener to turn on/off polling when ccloud auth happens.

  /** Monitor one or more statements on behalf of this codebase client. */
  register(clientId: string, statements: FlinkStatement | FlinkStatement[]): void {
    if (Array.isArray(statements)) {
      logger.debug(`Registering ${statements.length} statements for client ${clientId}`);
    } else {
      logger.debug(`Registering statement ${statements.id} for client ${clientId}`);
    }
    this.monitoredStatements.register(clientId, statements);
    if (this.poller && !this.poller.isRunning()) {
      // Start the poller if we are not already polling.
      logger.debug("Starting poller");
      this.poller.start();
    }
  }

  clearClient(clientId: string): void {
    logger.debug(`Clearing client ${clientId}`);
    this.monitoredStatements.deregisterClient(clientId);
    if (this.monitoredStatements.isEmpty() && this.poller) {
      // If we have no more statements to poll, stop the poller.
      logger.debug("Stopping poller");
      this.poller.stop();
    }
  }

  /**
   * Poll / update the nonterminal statements.
   *
   * @returns the number of statements polled.
   */
  async pollStatements(): Promise<void> {
    this.isPolling = true;

    try {
      if (this.monitoredStatements.isEmpty()) {
        logger.debug("Not polling, no statements to poll");
      }

      const loader = CCloudResourceLoader.getInstance();

      const statementsToPoll = this.getStatementsToPoll();
      logger.debug(`Polling ${statementsToPoll.length} statements for updates ...`);

      // TODO refactor into interior function for worker pool concurrency.
      for (const statement of statementsToPoll) {
        try {
          // Get the latest version of the statement.
          const latestStatement = await loader.refreshFlinkStatement(statement);
          if (latestStatement) {
            logger.debug(
              `Polled statement ${statement.id} - latest phase: ${latestStatement.phase} at ${latestStatement.updatedAt}`,
            );
            // may, may not update reference + fire event based on freshness.
            this.monitoredStatements.update(latestStatement);
          } else {
            // statement is now gone. Remove it from being monitored.
            logger.debug(
              `Statement ${statement.id} is no longer available, removing from monitored list.`,
            );
            this.monitoredStatements.remove(statement.id);
          }
        } catch (error) {
          // Many things can go wrong here, including network errors, etc.
          // XXX todo determine what to do here.
          logger.error(`Error polling statement ${statement.id}: ${error}`);
        }
      }
    } finally {
      if (this.monitoredStatements.isEmpty() && this.poller) {
        // If we have no more statements to poll, stop the poller.
        this.poller.stop();
      }

      this.isPolling = false;
    }
  }

  /**
   * Get the statements to poll.
   * This will return the first N statements to poll, where N is the configured limit.
   * If the limit is not set, it will return all nonterminal statements.
   */
  getStatementsToPoll(): FlinkStatement[] {
    // Get the list of statements to poll.
    const statementsToPoll = this.monitoredStatements.getAll();
    // Limit the number of statements to poll to the configured maximum.
    if (
      this.configuration.maxStatementsToPoll > 0 &&
      statementsToPoll.length > this.configuration.maxStatementsToPoll
    ) {
      logger.debug(
        `Limiting number of statements to poll from ${statementsToPoll.length} to ${this.configuration.maxStatementsToPoll}`,
      );
      // sort by updatedAt descending, so we poll the most recent ones first
      // aka get rid of the oldest ones as least likely to be updated.
      statementsToPoll.sort((a: FlinkStatement, b: FlinkStatement) => {
        return b.updatedAt!.getTime() - a.updatedAt!.getTime();
      });
      statementsToPoll.splice(this.configuration.maxStatementsToPoll);
    }
    logger.debug(`Polling ${statementsToPoll.length} updated statements`);

    return statementsToPoll;
  }
}

/**
 * Keeps track of nonterminal FlinkStatements that are being monitored by the extension.
 * When notified of a change to a statement, it will update the statement and emit the
 * new FlinkStatement to the {@link flinkStatementUpdated} event.
 */
export class MonitoredStatements {
  /** Mapping of nonterminal statement name -> binding of (most recent statement version, set of clients interested in it) */
  private monitored: Map<FlinkStatementId, MonitoredStatement> = new Map();

  /**
   * Monitor this/these nonterminal statements on behalf of this codebase client.
   *
   * @param clientId The id of the client to register.
   * @param statements The statement or statements to register.
   *
   * @throws Error if any of the statements are in a terminal state already (caller is buggy).
   * */
  register(clientId: string, statements: FlinkStatement | FlinkStatement[]): void {
    // Handle singleton by wrapping it in an array.
    if (!Array.isArray(statements)) {
      statements = [statements];
    }

    // Ensure all are sane before we modify anything.
    for (const statement of statements) {
      // If the statement is terminal, caller is confused.
      if (statement.isTerminal) {
        throw new Error(`Attempted to register a terminal statement ${statement.id}`);
      }
    }

    for (const statement of statements) {
      // If the statement is already being monitored, add the client id to the set of clients.
      // If this spelling of the statement is fresher than the one we have, update it and
      // emit the event to inform listeners.
      const existingBinding = this.monitored.get(statement.id);
      if (existingBinding) {
        // Record that this client id is also interested in the statement.
        existingBinding.addClientId(clientId);
        // Is this version of the statement fresher than the one we have?
        if (existingBinding.maybeUpdateStatement(statement)) {
          // emit event to inform listeners.
          flinkStatementUpdated.fire(existingBinding.statement);
        }
      } else {
        // Otherwise, create a new binding and add it to the map.
        // (No need to emit an event here, as the statement is new to us.)
        this.monitored.set(statement.id, new MonitoredStatement(clientId, statement));
      }
    }
  }

  /**
   * Remove statement / statements from the monitored list for this client id.
   * This is used when the client id is no longer interested in having specific statement(s) monitored.
   * If this is the last client id interested in a statement, it will be removed from the monitored list.
   * @param clientId Codebase client id to deregister specific statement(s) for.
   * @param statements The statement or statements to deregister.
   */
  deregister(clientId: string, statements: FlinkStatement | FlinkStatement[]): void {
    // Handle singleton by wrapping it in an array.
    if (!Array.isArray(statements)) {
      statements = [statements];
    }

    for (const statement of statements) {
      const existingBinding = this.monitored.get(statement.id);
      if (existingBinding) {
        const remainingClientCount = existingBinding.removeClientId(clientId);
        // If there are no more clients interested in this statement, remove it from the map.
        if (remainingClientCount === 0) {
          this.monitored.delete(statement.id);
        }
      }
    }
  }

  /**
   * Remove all statements from the monitored list for this client id.
   * This is used when the client id is no longer interested in having any of its statement(s) monitored,
   * such as when the flink statement view is switched to a different compute cluster or environment.
   *
   * If this is the last client id interested in a statement, the statement will be removed from the monitored list.
   * @param clientId Codebase client id to deregister specific statement(s) for.
   */
  deregisterClient(clientId: string): void {
    for (const binding of this.monitored.values()) {
      const remainingClientCount = binding.removeClientId(clientId);
      // If there are no more clients interested in this statement, remove it from the map.
      if (remainingClientCount === 0) {
        this.monitored.delete(binding.statement.id);
      }
    }
  }

  /**
   * Update a statement in the monitored list with a newly fetched version.
   *
   * If the proivided statement is fresher than the one we have, we will update it and emit an event to inform listeners.
   * If the statement is terminal, we will remove it from the monitored list.
   *
   * @returns True if the statement was updated, false otherwise, including if the statement was not found in the monitored list.
   * @param statement
   */
  update(statement: FlinkStatement): boolean {
    const existingBinding = this.monitored.get(statement.id);
    if (existingBinding) {
      if (existingBinding.maybeUpdateStatement(statement)) {
        // If the statement is terminal, remove it from the monitored list.
        if (statement.isTerminal) {
          this.monitored.delete(statement.id);
        }
        // Emit event to inform listeners.
        flinkStatementUpdated.fire(existingBinding.statement);
        return true;
      } else {
        // The statement was not updated, so we don't need to emit an event.
        return false;
      }
    } else {
      // Wacky, we don't have this statement in our monitored list. Race condition between
      // the monitoring and changing views, closing statement results, etc. can certainly happen.
      // Log it for the time being.
      logger.warn(`Attempted to update a statement ${statement.id} that we are not monitoring.`);
      return false;
    }
  }

  /** Remove this statement, independent of client ids.
   * Used when a statement has disappeared from ccloud-side.
   */
  remove(statementId: FlinkStatementId): void {
    this.monitored.delete(statementId);
    // Emit event to inform listeners.
    flinkStatementDeleted.fire(statementId);
    logger.debug(`Removed statement ${statementId} from monitored list.`);
  }

  /**
   * Remove all monitored statements, such as when no longer ccloud connected.
   */
  clear(): void {
    this.monitored.clear();
  }

  /** Are we empty? */
  isEmpty(): boolean {
    return this.monitored.size === 0;
  }

  /** Get array of all monitored statements */
  getAll(): FlinkStatement[] {
    return Array.from(this.monitored.values()).map((binding) => binding.statement);
  }
}

/**
 * Binding of a set of interested client ids to a (nonterminal) statement being monitored.
 * Helper for {@link MonitoredStatements}.
 */
export class MonitoredStatement {
  /** Statement being monitored within  */
  statement: FlinkStatement;
  clientIds: Set<string>;

  constructor(clientId: string, statement: FlinkStatement) {
    this.statement = statement;
    this.clientIds = new Set([clientId]);
  }

  addClientId(clientId: string): void {
    this.clientIds.add(clientId);
  }

  /**
   * Remove a client id from this binding.
   * @returns The number of client ids remaining in this binding.
   */
  removeClientId(clientId: string): number {
    this.clientIds.delete(clientId);
    return this.clientIds.size;
  }

  /**
   * Update the referenced statement if the provided one is fresher
   * than what we already have.
   *
   * @returns True if the statement was updated, false otherwise.
   */
  maybeUpdateStatement(statement: FlinkStatement): boolean {
    if (statement.isFresherThan(this.statement)) {
      this.statement = statement;
      return true;
    }
    return false;
  }
}
