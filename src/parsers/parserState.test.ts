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

  describe("ParserState edge cases", () => {
    it("handles empty input", () => {
      const state = new ParserState("");
      assert.strictEqual(state.peek(), null);
      assert.strictEqual(state.peekAt(0), null);
      assert.strictEqual(state.isEof(), true);
    });

    it("trims input on construction", () => {
      const state = new ParserState("  hello  ");
      assert.strictEqual(state.peek(), "h");
      const result = state.consumeWhile(() => true);
      assert.strictEqual(result, "hello");
    });
  });
});
