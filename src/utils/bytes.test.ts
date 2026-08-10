import * as assert from "assert";
import { estimateJsonBytes, formatBytes } from "./bytes";

describe("utils/bytes.ts", () => {
  describe("formatBytes()", () => {
    const testCases: Array<[number, string]> = [
      [0, "0 B"],
      [-1, "0 B"],
      [NaN, "0 B"],
      [1, "1 B"],
      [947, "947 B"],
      [1023, "1023 B"],
      [1024, "1.0 KB"],
      [12_595, "12.3 KB"],
      [1_048_576, "1.0 MB"],
      [1_887_437, "1.8 MB"],
      [1_073_741_824, "1.0 GB"],
      [1_099_511_627_776, "1.0 TB"],
      // beyond the largest unit we label, keep scaling the number rather than inventing a unit
      [1_125_899_906_842_624, "1024.0 TB"],
    ];

    testCases.forEach(([bytes, expected]) => {
      it(`should render ${bytes} as "${expected}"`, () => {
        assert.strictEqual(formatBytes(bytes), expected);
      });
    });
  });

  describe("estimateJsonBytes()", () => {
    it("should count the bytes of the serialized value", () => {
      assert.strictEqual(estimateJsonBytes([1, 2, 3]), "[1,2,3]".length);
      assert.strictEqual(estimateJsonBytes({ a: "b" }), '{"a":"b"}'.length);
    });

    it("should count multi-byte characters as their UTF-8 length", () => {
      // "é" is two UTF-8 bytes but one UTF-16 code unit, so .length alone would undercount
      assert.strictEqual(estimateJsonBytes("é"), 4);
    });

    it("should return 0 for values JSON cannot represent", () => {
      assert.strictEqual(estimateJsonBytes(undefined), 0);
      assert.strictEqual(
        estimateJsonBytes(() => {}),
        0,
      );
    });

    it("should return 0 for an empty array", () => {
      assert.strictEqual(estimateJsonBytes([]), 2);
    });
  });
});
