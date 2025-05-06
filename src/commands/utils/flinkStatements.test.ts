import * as assert from "assert";
import { localTimezoneOffset } from "./flinkStatements";

describe("commands/utils/flinkStatements.ts localTimezoneOffset()", function () {
  let originalTimezone: string | undefined;

  beforeEach(() => {
    originalTimezone = process.env.TZ;
  });
  afterEach(() => {
    if (originalTimezone) {
      process.env.TZ = originalTimezone;
    } else {
      delete process.env.TZ;
    }
  });

  it("Should extract offset relative to GMT", async function () {
    // Pin down timezone. May still be DST or not though based on the datetime.
    // (Can only do this once; internals of Date will cache the timezone offset?)
    process.env.TZ = "America/Los_Angeles";

    // This should be GMT-0700 for PDT or GMT-0800 for PST
    const offset = localTimezoneOffset();
    assert.strictEqual(offset.startsWith("GMT"), true, "Offset should end with GMT");
    // Fourth character should be + or -
    assert.strictEqual(offset[3] === "+" || offset[3] === "-", true, "Offset should be + or -");

    // Remainder will be either 0700 or 0800
    assert.strictEqual(
      offset.slice(4, 6) === "07" || offset.slice(4, 6) === "08",
      true,
      "Offset should be 0700 or 0800",
    );
    assert.strictEqual(offset.slice(6, 8) === "00", true, "Offset should be 00");
  });
});
