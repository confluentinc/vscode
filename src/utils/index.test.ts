import * as assert from "assert";
import { titleCase } from "./index";

describe("titleCase", () => {
  it("should convert the first character to uppercase and the rest to lowercase", () => {
    assert.strictEqual(titleCase("hello world"), "Hello world");
    assert.strictEqual(titleCase("HELLO WORLD"), "Hello world");
    assert.strictEqual(titleCase("hELLO wORLD"), "Hello world");
    assert.strictEqual(titleCase("hElLo WoRlD"), "Hello world");
  });

  it("should handle empty strings", () => {
    assert.strictEqual(titleCase(""), "");
  });

  it("should handle single character strings", () => {
    assert.strictEqual(titleCase("a"), "A");
    assert.strictEqual(titleCase("A"), "A");
  });
});
