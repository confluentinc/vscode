import * as assert from "assert";
import "mocha";
import * as sinon from "sinon";
import { Logger } from "../logging";
import {
  backoffWindow,
  IntervalPoller,
  pauseWithJitter,
  raceWithTimeout,
  retryWithBackoff,
  serverRequestedDelayMs,
} from "./timing";

describe("utils/timing", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("fake timers tests", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clock = sandbox.useFakeTimers(Date.now());
    });

    afterEach(() => {
      clock.restore();
    });

    describe("pauseWithJitter", () => {
      it("should pause", async () => {
        try {
          const minMs = 20;
          const maxMs = 50;

          // add callback to track when pauseWithJitter resolves
          let resolved = false;
          const promise = pauseWithJitter(minMs, maxMs).then(() => {
            resolved = true;
          });

          // shouldn't resolve yet
          assert.strictEqual(resolved, false, "resolved immediately");
          // fast forward just before minMs
          const firstJump = minMs - 1;
          await clock.tickAsync(firstJump);
          assert.strictEqual(resolved, false, "resolved too early");

          // fast forward past the maxMs time; should now be resolved
          await clock.tickAsync(maxMs - firstJump + 1);
          await promise;
          assert.strictEqual(resolved, true, "didn't resolve before maxMs time");
        } finally {
          clock.restore();
        }
      });

      it("should throw on invalid inputs", async () => {
        await assert.rejects(async () => {
          await pauseWithJitter(-1, 100);
        });
        await assert.rejects(async () => {
          await pauseWithJitter(100, -1);
        });
        await assert.rejects(async () => {
          await pauseWithJitter(100, 99);
        });
      });

      it("should return early and clear its timer when the signal aborts", async () => {
        const controller = new AbortController();
        const promise = pauseWithJitter(10_000, 10_000, controller.signal);
        await clock.tickAsync(100);
        // other modules (e.g. logging) may hold timers of their own, so count relative to now
        const timersWhilePaused = clock.countTimers();

        controller.abort();
        await promise;

        assert.strictEqual(clock.countTimers(), timersWhilePaused - 1);
      });

      it("should not wait at all on an already-aborted signal", async () => {
        const controller = new AbortController();
        controller.abort();

        await pauseWithJitter(10_000, 10_000, controller.signal);

        assert.strictEqual(clock.countTimers(), 0);
      });
    });

    describe("serverRequestedDelayMs", () => {
      function headers(h: Record<string, string>): Response {
        return new Response("", { status: 429, headers: h });
      }

      it("should read Retry-After in seconds", () => {
        assert.strictEqual(serverRequestedDelayMs(headers({ "retry-after": "2" })), 2000);
      });

      it("should read Retry-After as an HTTP-date relative to now", () => {
        const inFiveSeconds = new Date(Date.now() + 5000).toUTCString();

        const delay = serverRequestedDelayMs(headers({ "retry-after": inFiveSeconds }));

        // HTTP-dates have whole-second resolution, so up to 1s of the wait can be rounded away
        assert.ok(delay !== undefined && delay > 4000 && delay <= 5000, `got ${delay}`);
      });

      it("should ignore a Retry-After date in the past", () => {
        const past = new Date(Date.now() - 5000).toUTCString();

        assert.strictEqual(serverRequestedDelayMs(headers({ "retry-after": past })), undefined);
      });

      it("should fall back to X-RateLimit-Reset when Retry-After is absent", () => {
        assert.strictEqual(serverRequestedDelayMs(headers({ "x-ratelimit-reset": "3" })), 3000);
      });

      it("should prefer Retry-After over X-RateLimit-Reset", () => {
        const delay = serverRequestedDelayMs(
          headers({ "retry-after": "1", "x-ratelimit-reset": "3" }),
        );

        assert.strictEqual(delay, 1000);
      });

      it("should not fall back to X-RateLimit-Reset when Retry-After says retry now", () => {
        const delay = serverRequestedDelayMs(
          headers({ "retry-after": "0", "x-ratelimit-reset": "30" }),
        );

        assert.strictEqual(delay, undefined);
      });

      it("should return undefined without a usable header", () => {
        assert.strictEqual(serverRequestedDelayMs(headers({})), undefined);
        assert.strictEqual(serverRequestedDelayMs(headers({ "retry-after": "0" })), undefined);
        assert.strictEqual(serverRequestedDelayMs(headers({ "retry-after": "soon" })), undefined);
      });
    });

    describe("retryWithBackoff", () => {
      /** An error carrying a response, the way generated-client `ResponseError`s do. */
      class FakeResponseError extends Error {
        constructor(readonly response: Response) {
          super(`status ${response.status}`);
        }
      }

      function failure(status: number, h: Record<string, string> = {}): FakeResponseError {
        return new FakeResponseError(new Response("", { status, headers: h }));
      }

      const baseOptions = {
        operationName: "test",
        capMs: 30_000,
        maxRetries: 4,
        shouldRetry: (err: unknown) => err instanceof FakeResponseError,
      };

      beforeEach(() => {
        // pin jitter to the bottom of each window, so the shortest possible wait is what's tested
        sandbox.stub(Math, "random").returns(0);
      });

      it("should retry until the operation succeeds", async () => {
        const op = sandbox.stub();
        op.onFirstCall().rejects(failure(503));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, baseOptions);
        await clock.tickAsync(1000);

        assert.strictEqual(await promise, "ok");
        sinon.assert.calledTwice(op);
      });

      it("should rethrow the last error once maxRetries is spent", async () => {
        const last = failure(503);
        const op = sandbox.stub().rejects(failure(500));
        op.onCall(2).rejects(last);
        const warn = sandbox.stub(Logger.prototype, "warn");

        const promise = retryWithBackoff(op, { ...baseOptions, maxRetries: 2 });
        const rejected = assert.rejects(promise, (err) => err === last);
        await clock.tickAsync(60_000);

        await rejected;
        sinon.assert.calledThrice(op);
        sinon.assert.calledOnceWithMatch(warn, sinon.match(/after 2 retries/));
      });

      it("should not retry an error shouldRetry rejects", async () => {
        const op = sandbox.stub().rejects(new Error("nope"));

        await assert.rejects(retryWithBackoff(op, baseOptions), /nope/);

        sinon.assert.calledOnce(op);
      });

      it("should never retry sooner than a Retry-After in seconds", async () => {
        const op = sandbox.stub();
        op.onFirstCall().rejects(failure(429, { "retry-after": "7" }));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, baseOptions);
        await clock.tickAsync(6999);
        sinon.assert.calledOnce(op);
        await clock.tickAsync(1);

        assert.strictEqual(await promise, "ok");
        sinon.assert.calledTwice(op);
      });

      it("should never retry sooner than a Retry-After HTTP-date", async () => {
        // start on a whole second so the date header loses nothing to rounding
        clock.setSystemTime(Math.ceil(Date.now() / 1000) * 1000);
        const retryAt = new Date(Date.now() + 12_000).toUTCString();
        const op = sandbox.stub();
        op.onFirstCall().rejects(failure(429, { "retry-after": retryAt }));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, baseOptions);
        await clock.tickAsync(11_999);
        sinon.assert.calledOnce(op);
        await clock.tickAsync(1);

        assert.strictEqual(await promise, "ok");
      });

      it("should keep a Retry-After that exceeds the first backoff step", async () => {
        // 20s is well above the 1s first step, and must not be clamped down to it
        const op = sandbox.stub();
        op.onFirstCall().rejects(failure(429, { "retry-after": "20" }));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, baseOptions);
        await clock.tickAsync(19_999);
        sinon.assert.calledOnce(op);
        await clock.tickAsync(1);

        assert.strictEqual(await promise, "ok");
      });

      it("should wait for X-RateLimit-Reset when Retry-After is absent", async () => {
        const op = sandbox.stub();
        op.onFirstCall().rejects(failure(429, { "x-ratelimit-reset": "5" }));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, baseOptions);
        await clock.tickAsync(4999);
        sinon.assert.calledOnce(op);
        await clock.tickAsync(1);

        assert.strictEqual(await promise, "ok");
      });

      it("should ignore X-RateLimit-Reset on a response that isn't a 429", async () => {
        // CCloud sends the header on every response, so it says nothing about when a 503 clears
        const op = sandbox.stub();
        op.onFirstCall().rejects(failure(503, { "x-ratelimit-reset": "45" }));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, baseOptions);
        await clock.tickAsync(1000);

        assert.strictEqual(await promise, "ok");
      });

      it("should retry on the curve for a retryable error that carries no response", async () => {
        const op = sandbox.stub();
        op.onFirstCall().rejects(new Error("connection reset"));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, { ...baseOptions, shouldRetry: () => true });
        await clock.tickAsync(1000);

        assert.strictEqual(await promise, "ok");
      });

      it("should fail with the error instead of retrying early when the server asks for more than capMs", async () => {
        const tooLong = failure(429, { "retry-after": "600" });
        const op = sandbox.stub().rejects(tooLong);
        const warn = sandbox.stub(Logger.prototype, "warn");

        await assert.rejects(retryWithBackoff(op, baseOptions), (err) => err === tooLong);

        sinon.assert.calledOnce(op);
        sinon.assert.calledOnceWithMatch(warn, sinon.match(/over the 30000ms cap/));
      });

      it("should fail immediately for a far-future Retry-After date", async () => {
        const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toUTCString();
        const op = sandbox.stub().rejects(failure(429, { "retry-after": inAnHour }));

        await assert.rejects(retryWithBackoff(op, baseOptions));

        sinon.assert.calledOnce(op);
      });

      it("should give up instead of starting a wait that would end past deadlineMs", async () => {
        const last = failure(503);
        const op = sandbox.stub().rejects(failure(503));
        op.onSecondCall().rejects(last);
        const warn = sandbox.stub(Logger.prototype, "warn");

        // the first wait (1s) ends inside the 2.5s deadline, the second (1.6s) would not
        const promise = retryWithBackoff(op, { ...baseOptions, deadlineMs: 2500 });
        const rejected = assert.rejects(promise, (err) => err === last);
        await clock.tickAsync(1000);

        await rejected;
        sinon.assert.calledTwice(op);
        sinon.assert.calledOnceWithMatch(warn, sinon.match(/2500ms deadline/));
      });

      it("should cut a jittered wait short so the retry still starts inside deadlineMs", async () => {
        // jitter at the top of the 1000-1200ms window, with only 1100ms of budget left
        (Math.random as sinon.SinonStub).returns(0.999);
        const op = sandbox.stub();
        op.onFirstCall().rejects(failure(503));
        op.onSecondCall().resolves("ok");

        const promise = retryWithBackoff(op, { ...baseOptions, deadlineMs: 1100 });
        await clock.tickAsync(1100);

        sinon.assert.calledTwice(op);
        assert.strictEqual(await promise, "ok");
      });

      it("should rethrow the original error when aborted mid-wait", async () => {
        const original = failure(503);
        const controller = new AbortController();
        const op = sandbox.stub().rejects(original);

        const promise = retryWithBackoff(op, { ...baseOptions, signal: controller.signal });
        const rejected = assert.rejects(promise, (err) => err === original);
        await clock.tickAsync(10);
        controller.abort();

        await rejected;
        sinon.assert.calledOnce(op);
      });
    });

    describe("raceWithTimeout", () => {
      async function resolveIn(ms: number) {
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve("success"), ms);
        });
      }

      it("should resolve if function resolves before timeout", async () => {
        const promise = raceWithTimeout(
          resolveIn(50), // resolves in 50ms
          100, // timeout after 100ms
        );
        await clock.tickAsync(50);
        const result = await promise;
        assert.strictEqual(result, "success");
      });

      it("should reject if function takes longer than timeout", async () => {
        const promise = raceWithTimeout(
          resolveIn(100), // resolves in 100ms
          50, // timeout after 50ms
        );
        await clock.tickAsync(51); // advance past timeout
        await assert.rejects(promise, (err: Error) => {
          assert.strictEqual(err.message, "Timeout exceeded");
          return true;
        });
      });
    });
  });

  describe("backoffWindow", () => {
    it("should grow by 1.6x from a 1s base, with up to 20% jitter on top", () => {
      const windows = [0, 1, 2, 3].map((attempt) => backoffWindow(attempt, { capMs: 30_000 }));

      assert.deepStrictEqual(windows, [
        { minMs: 1000, maxMs: 1200 },
        { minMs: 1600, maxMs: 1920 },
        { minMs: 2560, maxMs: 3072 },
        { minMs: 4096, maxMs: 4915 },
      ]);
    });

    it("should stop growing at capMs", () => {
      assert.deepStrictEqual(backoffWindow(20, { capMs: 30_000 }), {
        minMs: 30_000,
        maxMs: 36_000,
      });
    });

    it("should start from baseMs when given", () => {
      assert.deepStrictEqual(backoffWindow(1, { capMs: 2000, baseMs: 100 }), {
        minMs: 160,
        maxMs: 192,
      });
    });

    it("should use a server delay as the floor when it is longer than the curve", () => {
      assert.deepStrictEqual(backoffWindow(0, { capMs: 30_000 }, 5000), {
        minMs: 5000,
        maxMs: 6000,
      });
    });

    it("should keep the curve when it is longer than the server delay", () => {
      assert.deepStrictEqual(backoffWindow(3, { capMs: 30_000 }, 1000), {
        minMs: 4096,
        maxMs: 4915,
      });
    });
  });

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
      const clock = sandbox.useFakeTimers(Date.now());
      const func = sandbox.stub();

      const poller = new IntervalPoller("test", func, 10, 5);
      poller.start();
      // 1ms past two slow-frequency intervals
      await clock.tickAsync(21);
      poller.stop();

      sinon.assert.callCount(func, 2);

      // reset and switch to fast-frequency polling
      func.resetHistory();
      poller.useFastFrequency();
      // 1ms past four fast-frequency intervals
      await clock.tickAsync(21);
      poller.stop();

      sinon.assert.callCount(func, 4);

      // reset and switch back to slow-frequency polling again
      func.resetHistory();
      poller.useSlowFrequency();
      // 1ms past five slow-frequency intervals
      await clock.tickAsync(51);
      poller.stop();
      sinon.assert.callCount(func, 5);
    });

    it("should throw on invalid frequencies", () => {
      assert.throws(() => {
        // fast frequency less than 1ms
        new IntervalPoller("test", () => {}, 10, 0);
      });
      assert.throws(() => {
        // slow frequency less 1ms
        new IntervalPoller("test", () => {}, 0, 10);
      });
      assert.throws(() => {
        // slow frequency not strictly greater than fast frequency
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

    it("should update `currentFrequency` appropriately", () => {
      const poller = new IntervalPoller("test", () => {}, 10, 2);
      assert.strictEqual(
        poller.currentFrequency,
        poller.slowFrequency,
        "Initial currentFrequency should match slowFrequency",
      );

      poller.useFastFrequency();
      assert.strictEqual(
        poller.currentFrequency,
        poller.fastFrequency,
        "currentFrequency should match fastFrequency",
      );

      poller.useSlowFrequency();
      assert.strictEqual(
        poller.currentFrequency,
        poller.slowFrequency,
        "currentFrequency should match slowFrequency",
      );
    });

    it("should not restart poller when useFastFrequency is called repeatedly", async () => {
      let callCount = 0;
      const func = () => {
        callCount += 1;
      };

      // run immediately to avoid waiting for the first call
      const poller = new IntervalPoller("test", func, 10, 2, true);
      poller.useFastFrequency();
      const initialCallCount = callCount;
      assert.equal(initialCallCount, 1, "Poller should have been called once");

      poller.useFastFrequency();
      poller.useFastFrequency();
      poller.useFastFrequency();

      poller.stop();
      assert.strictEqual(
        callCount,
        initialCallCount,
        "Poller should continue running without restarting",
      );
    });

    it("should not restart poller when useSlowFrequency is called repeatedly", async () => {
      let callCount = 0;
      const func = () => {
        callCount += 1;
      };

      // run immediately to avoid waiting for the first call
      const poller = new IntervalPoller("test", func, 10, 2, true);
      poller.useSlowFrequency();
      const initialCallCount = callCount;
      assert.equal(initialCallCount, 1, "Poller should have been called once");

      poller.useSlowFrequency();
      poller.useSlowFrequency();
      poller.useSlowFrequency();

      poller.stop();
      assert.strictEqual(
        callCount,
        initialCallCount,
        "Poller should continue running without restarting",
      );
    });
  });
});

async function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
