import * as assert from "assert";
import { datetimeLocalToTimestamp, timestampToDatetimeLocal } from "./dateUtils";

describe("utils/dateUtils.ts timestampToDatetimeLocal()", () => {
  it("should convert epoch milliseconds to datetime-local format", () => {
    const timestamp: number = Date.now();

    const result: string = timestampToDatetimeLocal(timestamp);

    assert.strictEqual(typeof result, "string");
    assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("should handle converting unix epoch correctly", () => {
    const epochTimestamp = 0;

    const result: string = timestampToDatetimeLocal(epochTimestamp);

    assert.strictEqual(typeof result, "string");
    assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("should pad single digits correctly", () => {
    // timestamp that has single digit month, day, hour, minute, second
    // (February 3rd, 2025 at 01:02:03.004)
    const timestamp: number = new Date(2025, 1, 3, 1, 2, 3, 4).getTime();

    const result: string = timestampToDatetimeLocal(timestamp);

    assert.match(result, /2025-02-03T01:02:03\.004/);
  });
});

// these are a bit overkill since datetimeLocalToTimestamp just wraps `new Date(datetimeLocal).getTime()`
// but should be fine for guarding against possible future breaking changes
describe("utils/dateUtils.ts datetimeLocalToTimestamp()", () => {
  it("should convert datetime-local format to epoch milliseconds", () => {
    const datetimeLocal = "2025-01-01T12:30:45.123";

    const result: number = datetimeLocalToTimestamp(datetimeLocal);

    assert.strictEqual(typeof result, "number");
    assert.ok(result > 0);
  });

  it("should handle datetime without milliseconds", () => {
    const datetimeLocal = "2024-01-01T12:30:45";

    const result: number = datetimeLocalToTimestamp(datetimeLocal);

    assert.strictEqual(typeof result, "number");
    assert.ok(result > 0);
  });

  it("should handle minimum datetime values", () => {
    const datetimeLocal = "1970-01-01T00:00:00.000";

    const result: number = datetimeLocalToTimestamp(datetimeLocal);

    // should be close to 0 for UTC, not going to assert exact value due to timezone differences
    assert.strictEqual(typeof result, "number");
  });
});

describe("utils/dateUtils.ts round-trip datetime conversions", () => {
  it("should maintain precision in round-trip conversion", () => {
    const originalTimestamp: number = Date.now();

    const datetimeLocal: string = timestampToDatetimeLocal(originalTimestamp);
    const roundTripTimestamp: number = datetimeLocalToTimestamp(datetimeLocal);

    assert.strictEqual(roundTripTimestamp, originalTimestamp);
  });

  it("should handle multiple round-trip conversions", () => {
    const testTimestamps = [
      0, // epoch
      new Date(2000, 0, 1, 0, 0, 0, 0).getTime(), // Y2K
      new Date(2025, 0, 1, 0, 0, 0, 0).getTime(), // 2025-01-01
      Date.now(), // current time
    ];

    testTimestamps.forEach((timestamp) => {
      const datetimeLocal: string = timestampToDatetimeLocal(timestamp);
      const roundTrip: number = datetimeLocalToTimestamp(datetimeLocal);

      assert.strictEqual(
        roundTrip,
        timestamp,
        `round-trip conversion failed for timestamp ${timestamp}`,
      );
    });
  });
});

describe("utils/dateUtils.ts format validation", () => {
  it("should produce valid datetime-local format for various timestamps", () => {
    const testCases = [
      { timestamp: 0, description: "epoch" },
      { timestamp: new Date(2000, 0, 1, 0, 0, 0, 0).getTime(), description: "Y2K" },
      { timestamp: new Date(2025, 0, 1, 0, 0, 0, 0).getTime(), description: "2025-01-01" },
      { timestamp: Date.now(), description: "current time" },
    ];
    testCases.forEach(({ timestamp, description }) => {
      const result = timestampToDatetimeLocal(timestamp);
      assert.match(
        result,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/,
        `Should produce valid format for ${description}`,
      );

      const parsed: number = datetimeLocalToTimestamp(result);
      assert.strictEqual(parsed, timestamp, `${description}: ${timestamp} expected, got ${parsed}`);
    });
  });

  it("should handle edge case dates", () => {
    // leap year (e.g. Feb 29, 2024)
    const leapYearDate: number = new Date(2024, 1, 29, 12, 0, 0, 0).getTime();
    const formatted: string = timestampToDatetimeLocal(leapYearDate);
    assert.match(formatted, /2024-02-29T12:00:00\.000/);

    // last timestamp of the year (e.g. Dec 31, 2024)
    const endOfYear: number = new Date(2024, 11, 31, 23, 59, 59, 999).getTime();
    const formattedEOY: string = timestampToDatetimeLocal(endOfYear);
    assert.match(formattedEOY, /2024-12-31T23:59:59\.999/);
  });
});
