/**
 * Parser state for character-level parsing operations.
 *
 * Provides low-level primitives for recursive descent parsing:
 * - Character peeking and consuming
 * - Word/identifier recognition
 * - Keyword matching with word boundaries
 * - Generic string parsing utilities
 *
 * This is a reusable component independent of any specific language grammar.
 */

export class ParserState {
  private readonly input: string;
  private pos: number = 0;

  constructor(input: string) {
    this.input = input.trim();
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
   * Consume and return the character at the current position.
   * Returns null if at end of input.
   */
  consume(): string | null {
    const ch = this.peek();
    if (ch !== null) {
      this.pos++;
    }
    return ch;
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
   * Skip whitespace characters.
   */
  skipWhitespace(): void {
    this.consumeWhile((ch) => /\s/.test(ch));
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
   * Reads consecutive word characters starting from current position.
   * Returns the word and the absolute position after the word.
   */
  peekWord(): { word: string; endPos: number } {
    let idx = 0;
    let word = "";
    // Read word characters from current position
    while (this.peekAt(idx) && /\w/.test(this.peekAt(idx)!)) {
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
    // Skip whitespace
    while (this.peekAt(idx) && /\s/.test(this.peekAt(idx)!)) {
      idx++;
    }
    // Collect word characters
    let word = "";
    while (this.peekAt(idx) && /\w/.test(this.peekAt(idx)!)) {
      word += this.peekAt(idx);
      idx++;
    }
    return word;
  }

  /**
   * Parse an identifier (sequence of word characters).
   * Stops at whitespace, commas, angle brackets, or parentheses.
   */
  parseIdentifier(): string {
    return this.consumeWhile((ch) => /\w/.test(ch));
  }

  /**
   * Parse an identifier that may contain spaces (like "WITH TIME ZONE").
   * Stops at specific delimiters: < > , ( ) NOT NULL NULL
   */
  parseIdentifierWithSpaces(): string {
    const start = this.peek();
    if (!start || !/\w/.test(start)) {
      throw new Error(`Expected identifier, got: ${start}`);
    }

    let result = "";
    let lastWasSpace = false;

    while (!this.isEof() && !this.shouldStopIdentifier()) {
      const ch = this.peek()!;

      if (/\s/.test(ch)) {
        if (!lastWasSpace) {
          result += " ";
          lastWasSpace = true;
        }
        this.consume();
      } else if (/\w/.test(ch)) {
        result += this.consume();
        lastWasSpace = false;
      } else {
        break;
      }
    }

    return result.trim();
  }

  /**
   * Check if we should stop parsing an identifier with spaces.
   * Stops at delimiters: < > , ( ) NOT NULL NULL '
   */
  private shouldStopIdentifier(): boolean {
    const ch = this.peek();
    if (!ch) return true;

    // Stop at specific delimiters
    if (ch === "<" || ch === ">" || ch === "," || ch === "(" || ch === ")" || ch === "'") {
      return true;
    }

    // Stop at NOT NULL or standalone NULL
    if (ch === "N") {
      const word = this.peekWord();
      if (word.word === "NOT" || word.word === "NULL") {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse characters until a specific character is found (non-inclusive).
   */
  parseUntilChar(stopChar: string): string {
    let result = "";
    while (!this.isEof() && this.peek() !== stopChar) {
      result += this.consume();
    }
    return result;
  }

  /**
   * Consume characters until the matching closing parenthesis is found.
   * Handles nested parentheses correctly.
   * Returns the content between parentheses (excluding the closing paren).
   */
  consumeUntilMatchingParen(): string {
    let content = "";
    let parenDepth = 0;

    while (!this.isEof()) {
      const ch = this.peek();

      if (ch === ")") {
        if (parenDepth === 0) {
          // Found the matching closing paren
          break;
        } else {
          parenDepth--;
          content += this.consume();
        }
      } else if (ch === "(") {
        parenDepth++;
        content += this.consume();
      } else {
        content += this.consume();
      }
    }

    return content.trim();
  }

  /**
   * Try to consume a specific keyword.
   * For multi-character keywords, checks word boundary (next char is not word char).
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
      if (nextChar && /\w/.test(nextChar)) {
        return false;
      }
    }

    // Consume the keyword
    for (let i = 0; i < keyword.length; i++) {
      this.consume();
    }

    return true;
  }
}
