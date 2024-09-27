import { equal, rejects } from "assert/strict";
import sinon from "sinon";
import { scheduler, semaphore } from "./scheduler";
import { performance } from "perf_hooks";

describe("scheduler", () => {
  const perf = sinon.stub(performance);

  it("should execute tasks in sequence", async () => {
    const promise = sinon.promise();
    const setTimeout = sinon.stub(global, "setTimeout");
    setTimeout.callsFake((fn: () => void) => (promise.then(fn), 0 as any));
    const schedule = scheduler(1, 100);

    const taskA = sinon.promise();
    perf.now.returns(0);
    const resultA = schedule(() => taskA);
    // task was complete within defined time window
    perf.now.returns(75);
    await taskA.resolve(0);

    // task completed
    equal(await resultA, 0);
    // delay requested for remaining of time window
    equal(setTimeout.callCount, 1);
    equal(setTimeout.getCall(0).args[1], 25);
    // perform delay
    await promise.resolve(0);

    const taskB = sinon.promise();
    perf.now.returns(0);
    const resultB = schedule(() => taskB);
    // task took longer than defined time window
    perf.now.returns(200);
    await taskB.resolve(1);

    // task completed
    equal(await resultB, 1);
    // no extra calls to delay
    equal(setTimeout.callCount, 1);
    setTimeout.restore();
  });

  it("should not execute more concurrent tasks than defined by limit", async () => {
    const promise = sinon.promise();
    const setTimeout = sinon.stub(global, "setTimeout");
    setTimeout.callsFake((fn: () => void) => (promise.then(fn), 0 as any));
    const schedule = scheduler(2, 100);

    const promiseA = sinon.promise();
    const taskA = sinon.fake(() => promiseA);
    const promiseB = sinon.promise();
    const taskB = sinon.fake(() => promiseB);
    const promiseC = sinon.promise();
    const taskC = sinon.fake(() => promiseC);
    const promiseD = sinon.promise();
    const taskD = sinon.fake(() => promiseD);

    perf.now.returns(0);
    const resultA = schedule(taskA);
    const resultB = schedule(taskB);
    const resultC = schedule(taskC);
    const resultD = schedule(taskD);

    equal(taskA.callCount, 1);
    equal(taskB.callCount, 1);
    equal(taskC.callCount, 0);

    perf.now.returns(85);
    await promiseA.resolve("a");
    equal(setTimeout.callCount, 1);
    equal(setTimeout.getCall(0).args[1], 15);
    equal(taskC.callCount, 0);
    equal(await resultA, "a");

    perf.now.returns(110);
    await promiseB.resolve("b");
    // second task didn't require delay
    equal(setTimeout.callCount, 1);
    // the pending task should be executed on the next tick
    await Promise.resolve();
    equal(taskC.callCount, 1);

    equal(await resultB, "b");

    await promiseC.resolve("c");
    equal(await resultC, "c");

    // still waiting for the delay after first task completion
    equal(taskD.callCount, 0);
    await promise.resolve(0);
    equal(taskD.callCount, 0);
    // the pending task should be executed on the next tick
    await Promise.resolve();
    equal(taskD.callCount, 1);
    await promiseD.resolve("d");
    equal(await resultD, "d");
    setTimeout.restore();
  });

  it("should skip aborted tasks", async () => {
    const promise = sinon.promise();
    const setTimeout = sinon.stub(global, "setTimeout");
    setTimeout.callsFake((fn: () => void) => (promise.then(fn), 0 as any));
    const schedule = scheduler(1, 100);
    const signal = AbortSignal.abort();
    await rejects(() => schedule(() => Promise.resolve(), signal));
    setTimeout.restore();
  });
});

describe("semaphore", () => {
  it("should acquire immediately", () => {
    const { acquire } = semaphore(1);
    equal(acquire(), true);
  });

  it("should await for release", async () => {
    const { acquire, release } = semaphore(1);
    acquire();
    setTimeout(() => release(), 0);
    const pending = acquire();
    equal(pending instanceof Promise, true);
    equal(await pending, true);
  });
});
