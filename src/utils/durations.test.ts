import * as assert from "assert";
import { formatDurationMillis, formatIsoDuration, isoDurationToMillis } from "./durations";

describe("utils/durations.ts", () => {
  describe("formatDurationMillis()", () => {
    const testCases: Array<[number, string]> = [
      [0, "0s"],
      [-500, "0s"],
      [NaN, "0s"],
      [1, "1ms"],
      [947, "947ms"],
      [1000, "1.0s"],
      [1250, "1.3s"],
      [59_400, "59.4s"],
      [60_000, "1m 0s"],
      [90_000, "1m 30s"],
      [3_599_000, "59m 59s"],
      [3_600_000, "1h 0m 0s"],
      [7_384_000, "2h 3m 4s"],
    ];

    testCases.forEach(([millis, expected]) => {
      it(`should render ${millis}ms as "${expected}"`, () => {
        assert.strictEqual(formatDurationMillis(millis), expected);
      });
    });
  });

  describe("isoDurationToMillis()", () => {
    const parseable: Array<[string, number]> = [
      ["PT1S", 1000],
      ["PT0.5S", 500],
      ["PT1M30S", 90_000],
      ["PT2H3M4S", 7_384_000],
      ["P1D", 86_400_000],
      ["P1DT2H", 93_600_000],
      [" PT30S ", 30_000],
    ];

    parseable.forEach(([duration, expected]) => {
      it(`should parse "${duration}" as ${expected}ms`, () => {
        assert.strictEqual(isoDurationToMillis(duration), expected);
      });
    });

    const unparseable: string[] = [
      "",
      "P",
      "PT",
      "90s",
      "1m30s",
      "P1Y",
      "PT1H30",
      "not a duration",
    ];

    unparseable.forEach((duration) => {
      it(`should return undefined for "${duration}"`, () => {
        assert.strictEqual(isoDurationToMillis(duration), undefined);
      });
    });
  });

  describe("formatIsoDuration()", () => {
    it("should format a parseable duration", () => {
      assert.strictEqual(formatIsoDuration("PT1M30S"), "1m 30s");
    });

    it("should fall back to the raw string when unparseable", () => {
      assert.strictEqual(formatIsoDuration("P1Y2M"), "P1Y2M");
    });
  });
});
