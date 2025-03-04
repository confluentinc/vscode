import * as assert from "assert";
import sinon from "sinon";
import { CancellationTokenSource, Progress } from "vscode";
import { executeInWorkerPool, extract, isErrorResult, isSuccessResult } from "./workerPool";

describe("utils/workerPool.ts executeInWorkerPool()", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should process items in parallel with multiple workers", async () => {
    const items = [1, 2, 3, 4];
    const callable = async (num: number) => num * 2;

    const results = await executeInWorkerPool(callable, items, { maxWorkers: 2 });

    assert.strictEqual(results.length, 4);
    assert.strictEqual(results.every(isSuccessResult), true);
    assert.deepStrictEqual(
      results.map((r) => r.result),
      [2, 4, 6, 8],
    );
  });

  it("should handle errors from callables", async () => {
    const items = [1, 2, 3];
    const callable = async (num: number) => {
      if (num === 2) throw new Error("test error");
      return num;
    };

    const results = await executeInWorkerPool(callable, items, { maxWorkers: 1 });

    assert.strictEqual(results.length, 3);
    assert.strictEqual(isSuccessResult(results[0]), true);
    assert.strictEqual(isErrorResult(results[1]), true);
    assert.strictEqual(isSuccessResult(results[2]), true);
  });

  it("should respect cancellation token by exiting early", async () => {
    const items: number[] = Array(10).fill(0);
    const callable = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return true;
    };
    const tokenSource = new CancellationTokenSource();

    const execution = executeInWorkerPool(
      callable,
      items,
      { maxWorkers: 2 },
      undefined,
      tokenSource.token,
    );
    tokenSource.cancel();
    const results = await execution;

    assert.strictEqual(results.length, items.length);
    // filter to exclude undefined results
    const definedResults = results.filter((r) => r !== undefined);
    assert.ok(definedResults.length < items.length);
  });

  it("should report progress", async () => {
    const items: number[] = [1, 2];
    const callable = async (n: number) => n;
    const progressStub: sinon.SinonStubbedInstance<Progress<any>> = {
      report: sandbox.stub(),
    };

    await executeInWorkerPool(callable, items, { maxWorkers: 1 }, progressStub);

    assert.strictEqual(progressStub.report.callCount, 2);
    sinon.assert.calledWithExactly(progressStub.report, { increment: 50 });
  });

  it("should limit worker count based on total item count", async () => {
    const items: number[] = [1, 2];
    const callable = async (n: number) => n;

    const results = await executeInWorkerPool(callable, items, { maxWorkers: 5 });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results.every(isSuccessResult), true);
  });

  it("should handle empty items array", async () => {
    const items: number[] = [];
    const callable = async (n: number) => n;

    const results = await executeInWorkerPool(callable, items, { maxWorkers: 1 });

    assert.strictEqual(results.length, 0);
  });

  it("should set maxWorkers defaults if out of range [2,100]", async () => {
    const items: number[] = [1, 2];
    const callable = async (n: number) => n;

    // this shouldn't happen in practice, but test it anyway
    const results = await executeInWorkerPool(callable, items, { maxWorkers: 0 });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results.every(isSuccessResult), true);
  });

  it("should handle undefined items in array", async () => {
    const items: (number | undefined)[] = [1, undefined, 3];
    const callable = async (n: number | undefined) => n;

    const results = await executeInWorkerPool(callable, items, { maxWorkers: 1 });

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[1], undefined);
  });

  it("should support custom progress messages", async () => {
    const items: number[] = [1];
    const callable = async (n: number) => n;
    const progressStub: sinon.SinonStubbedInstance<Progress<any>> = {
      report: sandbox.stub(),
    };

    await executeInWorkerPool(callable, items, { maxWorkers: 1 }, progressStub);

    sinon.assert.calledWith(progressStub.report, { increment: 100 });
  });

  it("should ensure result ordering maintains original item ordering", async () => {
    type WorkItem = [delay: number, index: number];
    const items: WorkItem[] = [
      [100, 0],
      [50, 1],
      [75, 2],
      [25, 3],
    ];
    const callable = async ([delay, index]: WorkItem) => {
      // simulate variable processing time for each item
      await new Promise((resolve) => setTimeout(resolve, delay));
      completionOrder.push(index);
      return index;
    };

    const completionOrder: number[] = [];
    const results = await executeInWorkerPool(callable, items, { maxWorkers: 4 });

    assert.strictEqual(results.length, 4);
    // the completion order should just be the index order in which the workers finished
    assert.deepStrictEqual(completionOrder, [3, 1, 2, 0]);
    // extract the `result` properties from each and ensure they match the original `items` ordering
    assert.deepStrictEqual(
      results.map((r) => r.result),
      [0, 1, 2, 3],
    );
  });

  it("If callback throws non-Error exception, it gets wrapped properly", async () => {
    const items = [1, 2, 3];
    const callable = async (num: number) => {
      if (num === 2) throw "test error";
      return num;
    };

    const results = await executeInWorkerPool(callable, items, { maxWorkers: 3 });

    assert.strictEqual(results.length, 3);
    assert.strictEqual(isSuccessResult(results[0]), true);
    assert.strictEqual(isErrorResult(results[1]), true);
    assert.ok(results[1].error instanceof Error);
    assert.strictEqual(
      results[1].error.message,
      "executeInWorkerPool(): Non-Error encountered when dispatching index 1",
    );
    assert.strictEqual(results[1].error.cause, "test error");
    assert.strictEqual(isSuccessResult(results[2]), true);
  });
});

describe("utils/workerPool.ts type guards", () => {
  it("isSuccessResult() should correctly identify a SuccessResult from an ExecutionResult", () => {
    assert.strictEqual(isSuccessResult({ result: 123 }), true);
    assert.strictEqual(isSuccessResult({ error: new Error() }), false);
  });

  it("isErrorResult() should correctly identify an ErrorResult from an ExecutionResult", () => {
    assert.strictEqual(isErrorResult({ error: new Error() }), true);
    assert.strictEqual(isErrorResult({ result: 123 }), false);
  });

  it("isSuccessResult() should handle undefined input by returning false", () => {
    assert.strictEqual(isSuccessResult(undefined), false);
  });

  it("isErrorResult() should handle undefined input by returning false", () => {
    assert.strictEqual(isErrorResult(undefined), false);
  });
});

describe("utils/workerPool.ts extract() tests", () => {
  it("should raise exception when first exception is found", async () => {
    const items = [1, 2, 3];
    const callable = async (num: number) => {
      if (num > 1) throw new Error(`test error ${num}`);
      return num;
    };

    const results = await executeInWorkerPool(callable, items);

    assert.strictEqual(results.length, 3);

    assert.throws(
      () => {
        const goodResults: number[] = extract(results);
      },
      { message: "test error 2" },
    );
  });

  it("should return array of results when no exceptions are found", async () => {
    const items = [1, 2, 3];
    const callable = async (num: number) => num;

    const results = await executeInWorkerPool(callable, items);

    assert.strictEqual(results.length, 3);

    const goodResults: number[] = extract(results);

    assert.deepStrictEqual(goodResults, [1, 2, 3]);
  });
});
