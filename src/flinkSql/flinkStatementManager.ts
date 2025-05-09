import { flinkStatementUpdated } from "../emitters";
import { Logger } from "../logging";
import { FlinkStatement, FlinkStatementId } from "../models/flinkStatement";

const logger = new Logger("FlinkStatementManager");

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

  /**
   * Remove all monitored statements, such as when no longer ccloud connected.
   */
  clear(): void {
    this.monitored.clear();
  }
}

/**
 * Binding of a set of interested client ids to a (nonterminal) statement being monitored.
 * Helper for {@link MonitoredStatements}.
 */
export class MonitoredStatement {
  /** Statement being monitored within  */
  private statement: FlinkStatement;
  private clientIds: Set<string>;

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
