import { equal, rejects } from "assert/strict";
import sinon from "sinon";
import { scheduler, semaphore } from "./scheduler";

describe("scheduler", () => {
  it("should execute tasks in sequence", async () => {
    const sandbox = sinon.createSandbox();
    const promise = sinon.promise();
    const setTimeout = sandbox.stub(global, "setTimeout");
    setTimeout.callsFake((fn: () => void) => (promise.then(fn), 0 as any));
    const schedule = scheduler(1, 100);

    const taskA = sinon.promise();
    const resultA = schedule(() => taskA);
    // delay requested to unblock the queue
    equal(setTimeout.callCount, 1);
    equal(setTimeout.getCall(0).args[1], 100);

    await taskA.resolve(0);
    // task completed
    equal(await resultA, 0);

    const taskB = sinon.promise();
    const resultB = schedule(() => taskB);
    // not yet called for release since the task is pending
    equal(setTimeout.callCount, 1);

    // perform delay
    await promise.resolve(0);
    await taskB.resolve(1);

    // task completed
    equal(await resultB, 1);
    equal(setTimeout.callCount, 2);
    equal(setTimeout.getCall(1).args[1], 100);
    sandbox.restore();
  });

  it("should not execute more concurrent tasks than defined by limit", async () => {
    const sandbox = sinon.createSandbox();
    const queue: (() => void)[] = [];
    const progressQueue = async () => {
      const cb = queue.shift();
      if (cb != null) cb();
    };
    const setTimeout = sandbox.stub(global, "setTimeout");
    setTimeout.callsFake((fn: () => void) => (queue.push(fn), 0 as any));
    const schedule = scheduler(2, 100);

    const promiseA = sinon.promise();
    const taskA = sinon.fake(() => promiseA);
    const promiseB = sinon.promise();
    const taskB = sinon.fake(() => promiseB);
    const promiseC = sinon.promise();
    const taskC = sinon.fake(() => promiseC);
    const promiseD = sinon.promise();
    const taskD = sinon.fake(() => promiseD);

    const resultA = schedule(taskA);
    const resultB = schedule(taskB);
    const resultC = schedule(taskC);
    const resultD = schedule(taskD);

    equal(queue.length, 2);
    equal(taskA.callCount, 1);
    equal(taskB.callCount, 1);
    equal(taskC.callCount, 0);
    equal(taskD.callCount, 0);

    await promiseA.resolve("a");
    equal(await resultA, "a");
    await progressQueue();
    equal(taskC.callCount, 1);
    equal(taskD.callCount, 0);

    await progressQueue();
    equal(taskC.callCount, 1);
    equal(taskD.callCount, 1);
    equal(queue.length, 2);

    await promiseB.resolve("b");
    equal(await resultB, "b");
    equal(taskC.callCount, 1);
    equal(taskD.callCount, 1);

    await promiseC.resolve("c");
    equal(await resultC, "c");
    await promiseD.resolve("d");
    equal(await resultD, "d");

    sandbox.restore();
  });

  it("should skip aborted tasks", async () => {
    const sandbox = sinon.createSandbox();
    const promise = sinon.promise();
    const setTimeout = sandbox.stub(global, "setTimeout");
    setTimeout.callsFake((fn: () => void) => (promise.then(fn), 0 as any));
    const schedule = scheduler(1, 100);
    const signal = AbortSignal.abort();
    await rejects(() => schedule(() => Promise.resolve(), signal));
    sandbox.restore();
  });
});

describe("semaphore", () => {
  it("should acquire immediately", () => {
    const { acquire } = semaphore(1);
    equal(acquire(), true);
  });

  it("should await for release", async () => {
    const { acquire, release } = semaphore(1);
    await acquire();
    setTimeout(() => release(), 0);
    const pending = acquire();
    equal(pending instanceof Promise, true);
    equal(await pending, true);
  });
});
