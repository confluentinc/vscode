import * as assert from "assert";
import { createHighlightRanges } from "./highlights";

describe("viewProviders/highlights.ts createHighlightRanges()", () => {
  it("should return empty array for empty inputs", () => {
    assert.deepStrictEqual(createHighlightRanges("", ""), []);
    assert.deepStrictEqual(createHighlightRanges("foobarbaz", ""), []);
    assert.deepStrictEqual(createHighlightRanges("", "search"), []);
  });

  it("should return empty array when substring not found", () => {
    assert.deepStrictEqual(createHighlightRanges("foobarbaz", "search"), []);
  });

  it("should find basic substring match", () => {
    assert.deepStrictEqual(createHighlightRanges("foobarbaz", "bar"), [[3, 6]]);
  });

  it("should match case insensitively", () => {
    assert.deepStrictEqual(createHighlightRanges("foobarbaz", "BaR"), [[3, 6]]);
    assert.deepStrictEqual(createHighlightRanges("FOOBARBAZ", "bar"), [[3, 6]]);
  });

  it("should handle matches at start and end of string", () => {
    assert.deepStrictEqual(createHighlightRanges("foobarbaz", "fo"), [[0, 2]]);
    assert.deepStrictEqual(createHighlightRanges("foobarbaz", "az"), [[7, 9]]);
  });

  it("should find multiple matches", () => {
    assert.deepStrictEqual(createHighlightRanges("foobarbazbar", "bar"), [
      [3, 6],
      [9, 12],
    ]);
  });
});
