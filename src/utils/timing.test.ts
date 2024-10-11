import * as assert from "assert";
import "mocha";
import { IntervalPoller, pauseWithJitter } from "./timing";

/** mocha tests over function pauseWithJitter */
describe("pauseWithJitter", () => {
  it("should pause", async () => {
    const start = Date.now();
    await pauseWithJitter(20, 50);
    // Give a little bit more padding for CI.
    const elapsed = Date.now() - start;
    assert.strictEqual(elapsed >= 20 && elapsed <= 55, true);
  });

  it("should throw on invalid inputs", () => {
    assert.rejects(async () => {
      await pauseWithJitter(-1, 100);
    });
    assert.rejects(async () => {
      await pauseWithJitter(100, -1);
    });
    assert.rejects(async () => {
      await pauseWithJitter(100, 99);
    });
  });
});

/** mocha tests over class IntervalPoller */

describe("IntervalPoller", () => {
  it("should start and stop", () => {
    const poller = new IntervalPoller("test", () => {});
    assert.strictEqual(poller.isRunning(), false);
    var rc = poller.start();
    assert.strictEqual(rc, true);
    assert.strictEqual(poller.isRunning(), true);

    // starting again should return false and be a no-op.
    rc = poller.start();
    assert.strictEqual(rc, false);

    rc = poller.stop();
    assert.strictEqual(rc, true);
    assert.strictEqual(poller.isRunning(), false);
  });

  it("calls polling function", async () => {
    let called = false;
    const func = () => {
      called = true;
    };
    const poller = new IntervalPoller("test", func, 10, 5);
    poller.start();
    await sleep(20);
    poller.stop();
    assert.strictEqual(called, true);
  });

  it("should work changing frequencies", async () => {
    let callCount = 0;
    const func = () => {
      callCount += 1;
    };
    const poller = new IntervalPoller("test", func, 10, 1);
    poller.start();
    await sleep(20);
    poller.stop();

    // should have been called either 1x or 2x, given
    // the 20ms sleep and the 10ms frequency.
    assert.strictEqual(
      callCount >= 1 && callCount <= 2,
      true,
      `First low frequency period calls: ${callCount}`,
    );

    // Reset, switch to 1ms high frequency, and check that it's called more often
    callCount = 0;
    // will reschedule with 1ms frequency and implicit start.
    poller.useHighFrequency();
    await sleep(20);
    poller.stop();
    // Wide window here 'cause on timing in CI is not very precise. But
    // if left in slow mode, will have been called 1-2 times.
    assert.strictEqual(
      callCount >= 5 && callCount <= 35,
      true,
      `High frequency period calls: ${callCount}`,
    );

    // and back to regular frequency again.
    callCount = 0;
    poller.useRegularFrequency();
    await sleep(20);
    poller.stop();
    assert.strictEqual(
      callCount >= 1 && callCount <= 2,
      true,
      `Second low frequency period calls: ${callCount}`,
    );
  });

  it("should throw on invalid frequencies", () => {
    assert.throws(() => {
      // active frequency less than 1ms
      new IntervalPoller("test", () => {}, 10, 0);
    });
    assert.throws(() => {
      // idle frequency less 1ms
      new IntervalPoller("test", () => {}, 0, 10);
    });
    assert.throws(() => {
      // idle frequency not strictly greater than active frequency
      new IntervalPoller("test", () => {}, 1, 1);
    });
  });

  it("should run the callback immediately if `runImmediately` is true", async () => {
    let callCount = 0;
    const func = () => {
      callCount += 1;
    };
    const poller = new IntervalPoller("test", func, 10, 5, true);
    poller.start();
    // don't wait at all, callback should have run as soon as start() was called
    assert.strictEqual(callCount, 1, "Callback wasn't called immediately on start");

    await sleep(20);
    poller.stop();
    assert.strictEqual(
      callCount >= 2,
      true,
      "Callback should be called at least once more after the initial call",
    );
  });
});

async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
