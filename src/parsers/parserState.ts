/**
 * Parser state for character-level parsing operations.
 *
 * Provides low-level primitives for recursive descent parsing:
 * - Character peeking and consuming
 * - Word/identifier recognition
 * - Keyword matching with word boundaries
 * - Generic string parsing utilities
 * - Configurable delimiter pairs for nested structure parsing
 *
 * This is a reusable component independent of any specific language grammar.
 */

export class ParserState {
  private readonly input: string;
  private pos: number = 0;
  private readonly delimiterMap: Map<string, string>;
  private readonly spacePattern: RegExp;
  private readonly wordPattern: RegExp;

  /**
   * Create a new ParserState.
   * @param input - The input string to parse
   * @param delimiterPairs - Even-length string of matching pairs (e.g., "(){}<>" means ( matches ), { matches }, < matches >)
   * @param spacePattern - Regex to match whitespace characters (default: /\s/)
   * @param wordPattern - Regex to match word characters (default: /\w/)
   */
  constructor(
    input: string,
    delimiterPairs: string = "",
    spacePattern: RegExp = /\s/,
    wordPattern: RegExp = /\w/,
  ) {
    this.input = input;
    this.spacePattern = spacePattern;
    this.wordPattern = wordPattern;

    // Build delimiter map from pairs string
    this.delimiterMap = new Map();
    if (delimiterPairs.length % 2 !== 0) {
      throw new Error(
        `delimiterPairs must have even length; got: "${delimiterPairs}" (length ${delimiterPairs.length})`,
      );
    }
    for (let i = 0; i < delimiterPairs.length; i += 2) {
      const openChar = delimiterPairs[i];
      const closeChar = delimiterPairs[i + 1];
      this.delimiterMap.set(openChar, closeChar);
    }
  }

  /**
   * Peek at the character at the current position without consuming it.
   * Returns null if at end of input.
   */
  peek(): string | null {
    if (this.pos >= this.input.length) {
      return null;
    }
    return this.input[this.pos];
  }

  /**
   * Peek at the character at current position + offset.
   * Returns null if out of bounds (including negative offsets).
   */
  peekAt(offset: number): string | null {
    const idx = this.pos + offset;
    if (idx < 0 || idx >= this.input.length) {
      return null;
    }
    return this.input[idx];
  }

  /**
   * Consume and return the next character(s) from the current position.
   * If count is not specified, consumes a single character.
   * Throws an error if count is not positive or exceeds remaining input.
   * @throws Error if count is not a positive integer (≤ 0)
   * @throws Error if count exceeds the number of remaining characters
   */
  consume(count: number = 1): string {
    if (count <= 0) {
      throw new Error(`Cannot consume non-positive number of characters: ${count}`);
    }
    const remaining = this.input.length - this.pos;
    if (count > remaining) {
      throw new Error(`Cannot consume ${count} character(s): only ${remaining} remaining in input`);
    }
    const start = this.pos;
    this.pos += count;
    return this.input.slice(start, this.pos);
  }

  /**
   * Consume characters while the predicate is true.
   * Returns the consumed substring. Uses O(n) slicing instead of O(n²) concatenation.
   */
  consumeWhile(predicate: (ch: string) => boolean): string {
    const start = this.pos;
    while (this.peek() !== null && predicate(this.peek()!)) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  /**
   * Skip whitespace characters (as defined by the spacePattern regex).
   */
  skipWhitespace(): void {
    this.consumeWhile((ch) => this.spacePattern.test(ch));
  }

  /**
   * Check if we're at the end of input.
   */
  isEof(): boolean {
    return this.peek() === null;
  }

  /**
   * Peek at the next word (identifier-like token) without consuming it.
   * Assumes caller has already skipped whitespace.
   * Reads consecutive word characters (as defined by wordPattern) starting from current position.
   * Returns the word and the absolute position after the word.
   */
  peekWord(): { word: string; endPos: number } {
    let idx = 0;
    let word = "";
    // Read word characters from current position.
    // Expected use: small tokens (keywords, identifiers), so O(n²) concatenation is acceptable.
    while (this.peekAt(idx) && this.wordPattern.test(this.peekAt(idx)!)) {
      word += this.peekAt(idx);
      idx++;
    }
    return { word, endPos: this.pos + idx };
  }

  /**
   * Peek at a word at the given offset, skipping whitespace first.
   * Returns the word found, or empty string if no word characters found.
   */
  peekWordAt(offset: number): string {
    let idx = offset;
    // Skip whitespace (as defined by spacePattern)
    while (this.peekAt(idx) && this.spacePattern.test(this.peekAt(idx)!)) {
      idx++;
    }
    // Collect word characters (as defined by wordPattern).
    // Expected use: small tokens (keywords), so O(n²) concatenation is acceptable.
    let word = "";
    while (this.peekAt(idx) && this.wordPattern.test(this.peekAt(idx)!)) {
      word += this.peekAt(idx);
      idx++;
    }
    return word;
  }

  /**
   * Parse an identifier (sequence of word characters as defined by wordPattern).
   */
  parseIdentifier(): string {
    return this.consumeWhile((ch) => this.wordPattern.test(ch));
  }

  /**
   * Parse an identifier that may contain spaces (e.g., "WITH TIME ZONE").
   * Stops at custom conditions or non-word/non-space characters.
   * @param shouldStop - Optional predicate for stop conditions (delimiters, keywords, punctuation, etc.)
   */
  parseIdentifierWithSpaces(shouldStop?: () => boolean): string {
    const start = this.peek();
    if (!start || !this.wordPattern.test(start)) {
      throw new Error(`Expected identifier, got: ${start}`);
    }

    let result = "";
    let lastWasSpace = false;

    while (!this.isEof()) {
      const ch = this.peek()!;

      // Allow caller to define stop conditions (delimiters, keywords, punctuation, etc.)
      if (shouldStop?.()) {
        break;
      }

      if (this.spacePattern.test(ch)) {
        if (!lastWasSpace) {
          result += " ";
          lastWasSpace = true;
        }
        this.consume();
      } else if (this.wordPattern.test(ch)) {
        result += this.consume();
        lastWasSpace = false;
      } else {
        break;
      }
    }

    return result.trim();
  }

  /**
   * Parse characters until a specific character is found (non-inclusive).
   * Uses O(n) slicing for efficiency.
   */
  parseUntilChar(stopChar: string): string {
    const start = this.pos;
    while (!this.isEof() && this.peek() !== stopChar) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  /**
   * Consume characters until the matching closing delimiter is found.
   * Handles nested delimiters correctly by only counting nesting of the same opening delimiter.
   * The current position must be at the specified opening delimiter.
   * Returns the content between the delimiters (excluding the closing delimiter).
   * @param openChar - The opening delimiter to match
   * @throws Error if current position is not at the specified opening delimiter
   * @throws Error if openChar is not a configured opening delimiter
   */
  consumeUntilMatchingDelimiter(openChar: string): string {
    if (!this.delimiterMap.has(openChar)) {
      throw new Error(`"${openChar}" is not a configured opening delimiter`);
    }

    const currentChar = this.peek();
    if (currentChar !== openChar) {
      throw new Error(
        `Expected opening delimiter "${openChar}" at current position, got: "${currentChar}"`,
      );
    }

    const closeChar = this.delimiterMap.get(openChar)!;
    this.consume(); // consume the opening delimiter

    const start = this.pos;
    let depth = 0;

    while (!this.isEof()) {
      const ch = this.peek();

      if (ch === closeChar) {
        if (depth === 0) {
          // Found the matching closing delimiter
          break;
        } else {
          depth--;
          this.pos++;
        }
      } else if (ch === openChar) {
        // This is the same opening delimiter - increase depth
        depth++;
        this.pos++;
      } else {
        this.pos++;
      }
    }

    return this.input.slice(start, this.pos).trim();
  }

  /**
   * Try to consume a specific keyword.
   * For multi-character keywords, checks word boundary (next char is not a word char per wordPattern).
   * For single-character tokens like "<" or ",", no word boundary check is needed.
   * Returns true if successful, false otherwise. If successful, advances the position past the keyword.
   * If the keyword is not found at the current position, does not consume anything and returns false.
   */
  tryConsume(keyword: string): boolean {
    for (let i = 0; i < keyword.length; i++) {
      if (this.peekAt(i) !== keyword[i]) {
        return false;
      }
    }

    // Check word boundary only for multi-character keywords (e.g., "ARRAY", "NOT")
    // Single-character tokens like "<", ",", ">" don't need word boundary checks
    if (keyword.length > 1) {
      const nextChar = this.peekAt(keyword.length);
      if (nextChar && this.wordPattern.test(nextChar)) {
        return false;
      }
    }

    // Consume the keyword
    this.consume(keyword.length);

    return true;
  }
}
