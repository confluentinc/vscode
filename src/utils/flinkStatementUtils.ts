import { FlinkStatement } from "../models/flinkStatement";
import { TERMINAL_PHASES } from "../models/flinkStatement";

/**
 * Checks if a Flink statement is in a terminal state
 * @param statement The Flink statement to check
 * @returns true if the statement is in a terminal state (COMPLETED, FAILED, or STOPPED)
 */
export function isStatementTerminal(statement: FlinkStatement): boolean {
  return TERMINAL_PHASES.includes(statement.phase.toUpperCase());
}
