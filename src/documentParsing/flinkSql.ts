import type { Uri } from "vscode";
import { Position, Range } from "vscode";
import { Logger } from "../logging";
import { getEditorOrFileContents } from "../utils/file";

const logger = new Logger("documentParsing.flinkSql");

// combined token pattern for Flink SQL lexical elements that can contain semicolons.
// alternation order provides precedence: backtick identifiers > strings > multi-line comments >
// single-line comments. each alternative consumes its full match, so special characters inside one
// construct (e.g. `--` inside a string) are never misidentified by a later alternative.
//
// references:
//   - backtick identifiers: `identifier` with `` for escaping
//   - single-quoted strings: 'text' with '' for escaping
//   - multi-line comments: /* ... */
//   - single-line comments: -- to end of line
//
// see https://docs.confluent.io/cloud/current/flink/reference/sql-syntax.html
const NON_CODE_TOKEN_PATTERN = /`(?:``|[^`])*`|'(?:''|[^'])*'|\/\*[\s\S]*?\*\/|--[^\n]*/;

/** Type of SQL statement based on execution semantics */
export enum StatementType {
  /** {@see https://nightlies.apache.org/flink/flink-docs-master/docs/dev/table/sql/set/} */
  SET = "SET",
  /** {@see https://nightlies.apache.org/flink/flink-docs-master/docs/dev/table/sql/use/ */
  USE = "USE",
  /** Any executable statement (SELECT, INSERT, CREATE, etc.) */
  EXECUTABLE = "EXECUTABLE",
}

/** Represents a single parsed SQL statement with its document range */
export interface ParsedStatement {
  text: string;
  range: Range;
  type: StatementType;
}

/** Represents an executable block (one or more statements that can be submitted together). */
export interface ExecutableBlock {
  statements: ParsedStatement[];
  range: Range;
  text: string;
  /** Whether this block includes SET/USE configuration statements */
  hasConfigStatements: boolean;
  /** Index of this block in the document (0-based) */
  index: number;
}

/**
 * Parse a Flink SQL document and return {@link ExecutableBlock executable blocks}, associating any
 * SET/USE statements with the subsequent executable portion of the statement document.
 *
 * NOTE: This uses semicolon-based statement splitting with proper handling of strings and comments.
 *
 * @param documentUri - URI of the document to parse
 */
export async function parseFlinkSqlDocument(documentUri: Uri): Promise<ExecutableBlock[]> {
  try {
    const { content } = await getEditorOrFileContents(documentUri);
    if (!content || content.trim().length === 0) {
      logger.debug("document is empty, returning no blocks");
      return [];
    }

    logger.debug(`parsing document with ${content.length} characters`, {
      uri: documentUri.toString(),
      preview: content.substring(0, 100),
    });

    const statements: ParsedStatement[] = splitIntoStatements(content);
    if (statements.length === 0) {
      logger.debug("no statements found in document");
      return [];
    }
    logger.debug(`parsed ${statements.length} statement(s) from document`);

    const blocks = groupStatementsIntoBlocks(statements);
    logger.debug(`grouped statements into ${blocks.length} executable blocks`);
    return blocks;
  } catch (error) {
    logger.error("Error parsing Flink SQL document", error);
    return [];
  }
}

/**
 * Find all semicolon character positions that are not inside strings, comments, or backtick
 * identifiers. Uses a single combined regex where alternation order provides correct precedence:
 * earlier alternatives consume their matches before later ones can misidentify special characters.
 *
 * @param content - The SQL document content
 * @returns Array of semicolon character positions in the original content
 */
function findValidSemicolons(content: string): number[] {
  // append `|;` to the shared non-code pattern so semicolons are captured as the final alternative
  const tokenRegex = new RegExp(`${NON_CODE_TOKEN_PATTERN.source}|;`, "g");
  const semicolons: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(content)) !== null) {
    if (match[0] === ";") {
      semicolons.push(match.index);
    }
  }
  return semicolons;
}

/**
 * Convert character position to line and column (0-based).
 *
 * @param content - The full document content
 * @param position - Character position in the content
 * @returns VS Code Position object
 */
function positionAt(content: string, position: number): Position {
  const textUpToPosition = content.substring(0, position);
  const lines = textUpToPosition.split("\n");
  const line = lines.length - 1;
  const column = lines[line].length;
  return new Position(line, column);
}

/** Remove all comments, strings, and backtick identifiers from text, returning only SQL keywords. */
function stripNonCodeTokens(text: string): string {
  return text.replace(new RegExp(NON_CODE_TOKEN_PATTERN.source, "g"), "").trim();
}

/**
 * Create a {@link ParsedStatement} from a text range if it contains executable SQL code.
 *
 * @param content - Full document content
 * @param startPos - Start character position
 * @param endPos - End character position
 */
function createStatementIfValid(
  content: string,
  startPos: number,
  endPos: number,
): ParsedStatement | null {
  const statementText: string = content.substring(startPos, endPos).trim();
  if (!statementText.length) {
    return null;
  }

  // confirm executable code exists (not just comments/whitespace)
  const codeOnly: string = stripNonCodeTokens(statementText);
  if (!codeOnly.length) {
    return null;
  }

  // find executable code start position, taking into account possible leading whitespace
  const leadingWhitespace = content.substring(startPos, endPos).match(/^\s*/);
  const actualStart = startPos + (leadingWhitespace ? leadingWhitespace[0].length : 0);

  return {
    text: statementText,
    type: classifyStatementType(statementText),
    range: new Range(positionAt(content, actualStart), positionAt(content, endPos)),
  };
}

/**
 * Find the end of a trailing single-line comment after a position, if one exists.
 * This ensures trailing comments stay with the statement they follow.
 *
 * @param content - The SQL document content
 * @param position - Starting position (typically semicolon + 1)
 * @returns Position after the trailing comment, or the original position if no comment found
 */
function findTrailingCommentEnd(content: string, position: number): number {
  // Check if there's a single-line comment starting after any whitespace
  const remainingText = content.substring(position);
  const trailingCommentMatch = remainingText.match(/^[ \t]*--[^\n]*/);

  if (trailingCommentMatch) {
    return position + trailingCommentMatch[0].length;
  }

  return position;
}

/**
 * Extract statements by splitting on semicolons (excluding comments/strings).
 * Includes trailing single-line comments with the statement they follow.
 *
 * @param content - Original SQL document content
 * @param semicolonPositions - Positions of valid semicolons
 * @returns Array of parsed statements with ranges
 */
function extractStatements(content: string, semicolonPositions: number[]): ParsedStatement[] {
  const statements: ParsedStatement[] = [];

  let statementStart = 0;

  for (const semicolonPos of semicolonPositions) {
    // Include any trailing single-line comment on the same line as the semicolon
    const statementEnd = findTrailingCommentEnd(content, semicolonPos + 1);

    const statement: ParsedStatement | null = createStatementIfValid(
      content,
      statementStart,
      statementEnd,
    );
    if (statement) {
      statements.push(statement);
    }
    statementStart = statementEnd;
  }

  // orphaned content after last semicolon
  if (statementStart < content.length) {
    const statement: ParsedStatement | null = createStatementIfValid(
      content,
      statementStart,
      content.length,
    );
    if (statement) {
      statements.push(statement);
    }
  }

  return statements;
}

/**
 * Split SQL content into individual statements using regex-based approach.
 * Properly handles semicolons inside strings and comments by ignoring them.
 *
 * @param content - The SQL document content
 * @returns Array of {@link ParsedStatement} objects
 */
function splitIntoStatements(content: string): ParsedStatement[] {
  const semicolonPositions: number[] = findValidSemicolons(content);
  return extractStatements(content, semicolonPositions);
}

/**
 * Group individual statements into {@link ExecutableBlock executable blocks} based on statement
 * types:
 * - SET/USE statements are attached to the next EXECUTABLE statement.
 * - Orphaned SET/USE statements (with no following executable) are skipped.
 *
 * @param statements - Array of parsed statements
 * @returns Array of executable blocks
 */
export function groupStatementsIntoBlocks(statements: ParsedStatement[]): ExecutableBlock[] {
  const blocks: ExecutableBlock[] = [];
  let partialStatementBlocks: ParsedStatement[] = [];
  let blockIndex = 0;

  for (const statement of statements) {
    if (statement.type === StatementType.SET || statement.type === StatementType.USE) {
      // gather SET/USE statements until they can be paired with an executable statement
      partialStatementBlocks.push(statement);
    } else {
      const blockStatements = [...partialStatementBlocks, statement];
      const block = createExecutableBlock(blockStatements, blockIndex);
      blocks.push(block);
      blockIndex++;
      // reset partials since they've been grouped with an executable statement
      partialStatementBlocks = [];
    }
  }

  if (partialStatementBlocks.length) {
    logger.debug(`skipping ${partialStatementBlocks.length} partial statement configs`);
  }
  return blocks;
}

/**
 * Create an {@link ExecutableBlock} from an array of {@link ParsedStatement statements}.
 *
 * @param statements - Array of statements to include in the block
 * @param index - Index of this block in the document
 * @returns ExecutableBlock
 */
function createExecutableBlock(statements: ParsedStatement[], index: number): ExecutableBlock {
  // Determine if this block has configuration statements
  const hasConfigStatements = statements.some(
    (s) => s.type === StatementType.SET || s.type === StatementType.USE,
  );

  // Calculate the combined range (from first statement start to last statement end)
  const firstStatement = statements[0];
  const lastStatement = statements[statements.length - 1];
  const combinedRange = new Range(firstStatement.range.start, lastStatement.range.end);

  // Combine statement texts
  const combinedText = statements.map((s) => s.text).join("\n");

  return {
    statements,
    range: combinedRange,
    text: combinedText,
    hasConfigStatements,
    index,
  };
}

/**
 * Determine the statement type from SQL text.
 * Uses simple pattern matching on the first keyword, ignoring leading comments.
 *
 * @param statementText - The SQL statement text
 * @returns Classification of the statement type
 */
export function classifyStatementType(statementText: string): StatementType {
  // Strip comments to find the actual SQL keyword
  // (statements can have leading comments like: -- comment\nSET 'key' = 'value';)
  const withoutComments = stripNonCodeTokens(statementText);
  const trimmed = withoutComments.trim().toUpperCase();

  // Check for SET statement
  if (trimmed.startsWith("SET ") || trimmed === "SET") {
    return StatementType.SET;
  }

  // Check for USE statement (catalog, database, or modules)
  if (
    trimmed.startsWith("USE ") ||
    trimmed.startsWith("USE CATALOG ") ||
    trimmed.startsWith("USE MODULES ") ||
    trimmed === "USE"
  ) {
    return StatementType.USE;
  }

  // Everything else is executable
  return StatementType.EXECUTABLE;
}

/**
 * Find the executable block that contains the given line number.
 * Useful for determining which block to submit when user clicks a codelens.
 *
 * @param blocks - Array of executable blocks
 * @param line - 0-based line number
 * @returns The block containing that line, or undefined
 */
export function getBlockAtLine(
  blocks: ExecutableBlock[],
  line: number,
): ExecutableBlock | undefined {
  return blocks.find((block) => line >= block.range.start.line && line <= block.range.end.line);
}
