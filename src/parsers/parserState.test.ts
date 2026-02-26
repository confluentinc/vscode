/**
 * Test suite for ParserState utility class.
 */

import assert from "assert";
import { ParserState } from "./parserState";

describe("ParserState", () => {
  describe("peekAt() negative offset handling", () => {
    it("returns null for negative offset", () => {
      const state = new ParserState("hello");
      assert.strictEqual(state.peekAt(-1), null);
    });

    it("returns null for negative offset from non-zero position", () => {
      const state = new ParserState("hello");
      state.consume(); // Move to position 1
      state.consume(); // Move to position 2
      assert.strictEqual(state.peekAt(-3), null); // -3 would go before start
    });

    it("returns null for offset beyond input length", () => {
      const state = new ParserState("hi");
      assert.strictEqual(state.peekAt(10), null);
    });

    it("returns correct character for valid positive offset", () => {
      const state = new ParserState("hello");
      assert.strictEqual(state.peekAt(0), "h");
      assert.strictEqual(state.peekAt(1), "e");
      assert.strictEqual(state.peekAt(4), "o");
    });

    it("returns null when negative offset would place before input start", () => {
      const state = new ParserState("abc");
      state.consume(); // pos = 1
      assert.strictEqual(state.peekAt(-2), null); // 1 + (-2) = -1, out of bounds
    });
  });

  describe("consumeWhile() performance and correctness", () => {
    it("consumes characters matching predicate", () => {
      const state = new ParserState("aaabbbccc");
      const result = state.consumeWhile((ch) => ch === "a");
      assert.strictEqual(result, "aaa");
    });

    it("handles empty match (predicate false immediately)", () => {
      const state = new ParserState("bbbccc");
      const result = state.consumeWhile((ch) => ch === "a");
      assert.strictEqual(result, "");
    });

    it("consumes entire input when predicate always true", () => {
      const state = new ParserState("hello");
      const result = state.consumeWhile(() => true);
      assert.strictEqual(result, "hello");
    });

    it("handles whitespace consumption correctly", () => {
      const state = new ParserState("hello   world");
      const result = state.consumeWhile((ch) => /\w/.test(ch));
      assert.strictEqual(result, "hello");
      assert.strictEqual(state.peek(), " ");
    });

    it("handles word characters correctly", () => {
      const state = new ParserState("hello123world");
      const result = state.consumeWhile((ch) => /\w/.test(ch));
      assert.strictEqual(result, "hello123world");
    });

    it("stops at delimiter", () => {
      const state = new ParserState("hello,world");
      const result = state.consumeWhile((ch) => ch !== ",");
      assert.strictEqual(result, "hello");
      assert.strictEqual(state.peek(), ",");
    });

    it("handles long input correctly (performance test)", () => {
      // Create a long string of repeated characters
      const longInput = "a".repeat(10000);
      const state = new ParserState(longInput);
      const result = state.consumeWhile((ch) => ch === "a");
      assert.strictEqual(result, longInput);
      assert.strictEqual(result.length, 10000);
    });

    it("correctly advances position after consumeWhile", () => {
      const state = new ParserState("aaabbbccc");
      state.consumeWhile((ch) => ch === "a");
      assert.strictEqual(state.peek(), "b");
    });

    it("allows multiple consumeWhile calls in sequence", () => {
      const state = new ParserState("aaabbbccc");
      const first = state.consumeWhile((ch) => ch === "a");
      const second = state.consumeWhile((ch) => ch === "b");
      const third = state.consumeWhile((ch) => ch === "c");
      assert.strictEqual(first, "aaa");
      assert.strictEqual(second, "bbb");
      assert.strictEqual(third, "ccc");
      assert.strictEqual(state.peek(), null);
    });

    it("handles numeric predicates", () => {
      const state = new ParserState("12345abc");
      const result = state.consumeWhile((ch) => /\d/.test(ch));
      assert.strictEqual(result, "12345");
      assert.strictEqual(state.peek(), "a");
    });
  });

  describe("consume() with character count", () => {
    it("consumes single character by default", () => {
      const state = new ParserState("hello");
      assert.strictEqual(state.consume(), "h");
      assert.strictEqual(state.peek(), "e");
    });

    it("consumes multiple characters with count", () => {
      const state = new ParserState("hello");
      assert.strictEqual(state.consume(3), "hel");
      assert.strictEqual(state.peek(), "l");
    });

    it("consumes entire remaining input", () => {
      const state = new ParserState("hi");
      assert.strictEqual(state.consume(2), "hi");
      assert(state.isEof());
    });

    // Parameterized error cases
    const errorCases = [
      {
        count: -1,
        input: "hello",
        pattern: /Cannot consume non-positive number of characters: -1/,
      },
      { count: 0, input: "hello", pattern: /Cannot consume non-positive number of characters: 0/ },
      {
        count: 5,
        input: "hi",
        pattern: /Cannot consume 5 character\(s\): only 2 remaining in input/,
      },
    ];

    errorCases.forEach(({ count, input, pattern }) => {
      it(`throws on invalid count=${count} for input="${input}"`, () => {
        const state = new ParserState(input);
        assert.throws(() => state.consume(count), pattern);
      });
    });

    it("throws when count exceeds remaining after partial consumption", () => {
      const state = new ParserState("hello");
      state.consume(2); // pos = 2
      assert.throws(
        () => state.consume(10),
        /Cannot consume 10 character\(s\): only 3 remaining in input/,
      );
    });
  });

  describe("configurable delimiter pairs", () => {
    it("throws on odd-length delimiter string", () => {
      assert.throws(() => new ParserState("test", "(<>"), /delimiterPairs must have even length/);
    });

    it("consumes until matching delimiter with parentheses", () => {
      const state = new ParserState("(hello)", "()");
      assert.strictEqual(state.peek(), "(");
      const result = state.consumeUntilMatchingDelimiter("(");
      assert.strictEqual(result, "hello");
      assert.strictEqual(state.peek(), ")");
    });

    it("consumes until matching delimiter with angle brackets", () => {
      const state = new ParserState("<INT>", "<>");
      assert.strictEqual(state.peek(), "<");
      const result = state.consumeUntilMatchingDelimiter("<");
      assert.strictEqual(result, "INT");
      assert.strictEqual(state.peek(), ">");
    });

    it("handles nested matching delimiters (same type)", () => {
      const state = new ParserState("(foo(bar)baz)", "()");
      const result = state.consumeUntilMatchingDelimiter("(");
      assert.strictEqual(result, "foo(bar)baz");
    });

    it("only matches specified opener, ignoring other delimiter pairs", () => {
      // "(foo<bar)" - when matching "(", should NOT be tricked by "<"
      const state = new ParserState("(foo<bar)", "()<>");
      const result = state.consumeUntilMatchingDelimiter("(");
      assert.strictEqual(result, "foo<bar");
    });

    it("handles interleaved delimiters correctly - stops at matching close", () => {
      // "({)}" - when matching "(", should stop at the matching ")"
      // and NOT be fooled by "{" in between (which has no matching "}")
      const state = new ParserState("({)}", "(){}<>");
      const result = state.consumeUntilMatchingDelimiter("(");
      assert.strictEqual(result, "{");
      assert.strictEqual(state.peek(), ")");
    });

    it("handles deeply nested same delimiter inside different delimiter", () => {
      // "<(a(b)c)>" - when matching "<", should correctly handle nested parens inside
      const state = new ParserState("<(a(b)c)>", "(){}<>");
      const result = state.consumeUntilMatchingDelimiter("<");
      assert.strictEqual(result, "(a(b)c)");
    });

    it("throws when not at specified opening delimiter", () => {
      const state = new ParserState("hello", "()");
      assert.throws(
        () => state.consumeUntilMatchingDelimiter("("),
        /Expected opening delimiter "\(" at current position/,
      );
    });

    it("throws when opener is not configured", () => {
      const state = new ParserState("hello", "()");
      assert.throws(
        () => state.consumeUntilMatchingDelimiter("{"),
        /is not a configured opening delimiter/,
      );
    });
  });

  describe("custom space and word patterns", () => {
    it("uses custom word pattern for parseIdentifier", () => {
      // Custom pattern: only lowercase letters are word chars
      const customWordPattern = /[a-z]/;
      const state = new ParserState("hello123", "", /\s/, customWordPattern);
      const result = state.parseIdentifier();
      assert.strictEqual(result, "hello");
      assert.strictEqual(state.peek(), "1");
    });

    it("uses custom space pattern for skipWhitespace", () => {
      // Custom pattern: treat underscore as space
      const customSpacePattern = /_/;
      const customWordPattern = /[a-z]/; // restrict to letters so _ is not part of word
      const state = new ParserState("hello_world", "", customSpacePattern, customWordPattern);
      state.parseIdentifier(); // consume "hello"
      assert.strictEqual(state.peek(), "_"); // at underscore
      state.skipWhitespace(); // skip underscore using custom pattern
      assert.strictEqual(state.peek(), "w"); // now at 'w'
    });

    it("uses custom patterns in peekWord", () => {
      const customWordPattern = /[a-z]/;
      const customSpacePattern = / /;
      const state = new ParserState("hello 123", "", customSpacePattern, customWordPattern);
      const word = state.peekWord();
      assert.strictEqual(word.word, "hello");
    });

    it("uses custom patterns in parseIdentifierWithSpaces", () => {
      const customWordPattern = /[a-z]/;
      const customSpacePattern = / /;
      const state = new ParserState("hello world 123", "", customSpacePattern, customWordPattern);
      const result = state.parseIdentifierWithSpaces();
      assert.strictEqual(result, "hello world");
      assert.strictEqual(state.peek(), "1");
    });
  });

  describe("ParserState edge cases", () => {
    it("handles empty input", () => {
      const state = new ParserState("");
      assert.strictEqual(state.peek(), null);
      assert.strictEqual(state.peekAt(0), null);
      assert.strictEqual(state.isEof(), true);
    });

    it("preserves input exactly as provided (no trimming)", () => {
      const state = new ParserState("  hello  ");
      assert.strictEqual(state.peek(), " ");
      const result = state.consumeWhile(() => true);
      assert.strictEqual(result, "  hello  ");
    });
  });
});
