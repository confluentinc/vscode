import type * as vscode from "vscode";
import type { Disposable, EventEmitter } from "vscode";
import { WebSocket } from "ws";
import {
  MessageRequestDataMap,
  MessageResponseDataMap,
  ResponseMessage,
  VSCodeHandleObject,
} from "./protocol";

export type VSCode = typeof vscode;

export type Unboxed<Arg> =
  Arg extends ObjectHandle<infer T>
    ? T
    : Arg extends [infer A0]
      ? [Unboxed<A0>]
      : Arg extends [infer A0, infer A1]
        ? [Unboxed<A0>, Unboxed<A1>]
        : Arg extends [infer A0, infer A1, infer A2]
          ? [Unboxed<A0>, Unboxed<A1>, Unboxed<A2>]
          : Arg extends [infer A0, infer A1, infer A2, infer A3]
            ? [Unboxed<A0>, Unboxed<A1>, Unboxed<A2>, Unboxed<A3>]
            : Arg extends Array<infer T>
              ? Array<Unboxed<T>>
              : Arg extends object
                ? { [Key in keyof Arg]: Unboxed<Arg[Key]> }
                : Arg;
export type VSCodeFunction0<R> = () => R | Thenable<R>;
export type VSCodeFunction<Arg, R> = (arg: Unboxed<Arg>) => R | Thenable<R>;
export type VSCodeFunctionOn<On, Arg2, R> = (on: On, arg2: Unboxed<Arg2>) => R | Thenable<R>;

export type VSCodeHandle<T> =
  T extends EventEmitter<infer R> ? EventEmitterHandle<R> : ObjectHandle<T>;

export class VSCodeEvaluator {
  private _lastId = 0;
  private _ws: WebSocket;
  private _pending = new Map<number, { resolve: Function; reject: Function }>();
  private _cache = new Map<number, ObjectHandle<unknown>>();
  private _listeners = new Map<number, Set<(event?: any) => any>>();
  private _page: any;

  private _responseHandler = (json: string) => {
    const { op, id, data } = JSON.parse(json) as ResponseMessage;

    if (op === "dispatchEvent") {
      const { objectId, event } = data as MessageResponseDataMap["dispatchEvent"];
      const listeners = this._listeners.get(objectId);
      if (listeners) {
        for (const listener of listeners) listener(event);
      }
      return;
    }

    if (id && !this._pending.has(id))
      throw new Error(`Could not find promise for request with ID ${id}`);
    const { resolve, reject } = this._pending.get(id);
    this._pending.delete(id);

    switch (op) {
      case "release":
      case "registerEvent":
      case "unregisterEvent": {
        resolve();
        return;
      }
      case "invokeMethod": {
        const { error, result } = data as MessageResponseDataMap["invokeMethod"];
        if (error) {
          const e = new Error(error.message);
          e.stack = error.stack;
          reject(e);
        } else {
          resolve({ result });
        }
        return;
      }
    }
  };

  constructor(ws: WebSocket, pageImpl: any) {
    this._ws = ws;
    this._page = pageImpl;
    this._ws.on("message", (data) => this._responseHandler(data.toString()));
    this._cache.set(0, new ObjectHandle(0, this));
  }

  rootHandle(): ObjectHandle<VSCode> {
    return this._cache.get(0) as ObjectHandle<VSCode>;
  }

  async evaluate<R>(
    objectId: number,
    returnHandle: false,
    fn: VSCodeFunctionOn<any, void, R>,
  ): Promise<R>;
  async evaluate<R>(
    objectId: number,
    returnHandle: true,
    fn: VSCodeFunctionOn<any, void, R>,
  ): Promise<VSCodeHandle<R>>;
  async evaluate<R, Arg>(
    objectId: number,
    returnHandle: false,
    fn: VSCodeFunctionOn<any, Arg, R>,
    arg?: Arg,
  ): Promise<R>;
  async evaluate<R, Arg>(
    objectId: number,
    returnHandle: true,
    fn: VSCodeFunctionOn<any, Arg, R>,
    arg?: Arg,
  ): Promise<VSCodeHandle<R>>;
  async evaluate<R, Arg>(
    objectId: number,
    returnHandle: boolean,
    fn: VSCodeFunctionOn<any, Arg, R>,
    arg?: Arg,
  ) {
    function toParam(arg: any): any {
      if (["string", "number", "boolean", "null", "undefined"].includes(typeof arg)) return arg;
      if (arg instanceof ObjectHandle)
        return {
          __vscodeHandle: arg instanceof EventEmitterHandle ? "eventEmitter" : true,
          objectId: arg.objectId,
        };
      if (Array.isArray(arg)) return arg.map(toParam);
      return Object.fromEntries(Object.entries(arg).map(([k, v]) => [k, toParam(v)]));
    }

    const params = arg !== undefined ? [toParam(arg)] : [];
    const { result } = await this._sendAndWaitWithTrace("invokeMethod", {
      objectId,
      returnHandle,
      fn: fn.toString(),
      params,
    });
    if (!returnHandle) return result;

    const handleObj = result as VSCodeHandleObject;
    let handle = this._cache.get(handleObj.objectId);
    if (!handle) {
      handle = new (
        handleObj.__vscodeHandle === "eventEmitter" ? EventEmitterHandle : ObjectHandle
      )(handleObj.objectId, this);
      this._cache.set(handleObj.objectId, handle);
    }
    return handle;
  }

  async addListener<R>(objectId: number, listener: (event: R) => any) {
    if (!this._cache.has(objectId)) throw new Error(`No handle with id ${objectId}`);
    let listeners = this._listeners.get(objectId);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(objectId, listeners);
    }

    if (listeners.has(listener)) return;

    listeners.add(listener);
    await this._sendAndWait("registerEvent", { objectId });
  }

  async removeListener<R>(objectId: number, listener: (event: R) => any) {
    const listeners = this._listeners.get(objectId);
    if (!listeners?.has(listener)) return;
    listeners.delete(listener);
    await this._sendAndWait("unregisterEvent", { objectId });
  }

  async release(objectId: number, options?: { dispose?: boolean }) {
    this._listeners.delete(objectId);
    if (!this._cache.delete(objectId)) return;
    await this._sendAndWaitWithTrace("release", { objectId, ...options });
  }

  async dispose() {
    await Promise.all([...this._cache.keys()].map((objectId) => this.release(objectId))).catch(
      () => {},
    );
    this._ws.removeListener("data", this._responseHandler);
    for (const [id, { reject }] of this._pending.entries())
      reject(new Error(`No response for request ${id} received from VSCode`));
  }

  private async _sendAndWait<K extends keyof MessageRequestDataMap>(
    op: K,
    data: MessageRequestDataMap[K],
  ): Promise<MessageResponseDataMap[K]> {
    const id = ++this._lastId;
    this._ws.send(JSON.stringify({ op, id, data }));
    return await new Promise((resolve, reject) => this._pending.set(id, { resolve, reject }));
  }

  private async _sendAndWaitWithTrace<K extends keyof MessageRequestDataMap>(
    op: K,
    data: MessageRequestDataMap[K],
  ): Promise<MessageResponseDataMap[K]> {
    if (!this._page) return await this._sendAndWait(op, data);

    const { monotonicTime, createGuid } = require("playwright-core/lib/utils");
    const tracing = this._page.context().tracing;
    const frame = this._page.mainFrame();
    const metadata = {
      id: `vscodecall@${(data as any).id ?? createGuid()}`,
      startTime: monotonicTime(),
      endTime: 0,
      // prevents pause action from being written into calllogs
      internal: false,
      objectId: frame.guid,
      pageId: this._page.guid,
      frameId: frame.guid,
      type: "JSHandle",
      method: (data as MessageRequestDataMap["invokeMethod"])?.returnHandle
        ? "evaluateExpressionHandle"
        : "evaluateExpression",
      params: { op, data },
      log: [] as string[],
    };
    await tracing.onBeforeCall(frame, metadata);
    let error: any, result: any;
    try {
      result = await this._sendAndWait(op, data);
      return result;
    } catch (e: any) {
      error = { error: { message: e.message, stack: e.stack, name: e.name } };
      throw e;
    } finally {
      await tracing.onAfterCall(frame, { ...metadata, endTime: monotonicTime(), error, result });
    }
  }
}

export class ObjectHandle<T = VSCode> {
  readonly objectId: number;
  protected _evaluator: VSCodeEvaluator;
  private _released = false;

  constructor(objectId: number, evaluator: VSCodeEvaluator) {
    this.objectId = objectId;
    this._evaluator = evaluator;
  }

  evaluate<R>(vscodeFunction: VSCodeFunctionOn<T, void, R>): Promise<R>;
  evaluate<R, Arg>(vscodeFunction: VSCodeFunctionOn<T, Arg, R>, arg: Arg): Promise<R>;
  evaluate<R, Arg>(vscodeFunction: VSCodeFunctionOn<T, Arg, R>, arg?: Arg): Promise<R> {
    if (this._released) throw new Error(`Handle is released`);
    return this._evaluator.evaluate(this.objectId, false, vscodeFunction, arg);
  }

  evaluateHandle<R>(vscodeFunction: VSCodeFunctionOn<T, void, R>): Promise<VSCodeHandle<R>>;
  evaluateHandle<R, Arg>(
    vscodeFunction: VSCodeFunctionOn<T, Arg, R>,
    arg: Arg,
  ): Promise<VSCodeHandle<R>>;
  evaluateHandle<R, Arg>(
    vscodeFunction: VSCodeFunctionOn<T, Arg, R>,
    arg?: Arg,
  ): Promise<VSCodeHandle<R>> {
    if (this._released) throw new Error(`Handle is released`);
    return this._evaluator.evaluate(this.objectId, true, vscodeFunction, arg);
  }

  release<O extends T extends Disposable ? { dispose: boolean } : {}>(options?: O): Promise<void>;
  async release(options?: { dispose?: boolean }) {
    this._released = true;
    await this._evaluator.release(this.objectId, options);
  }
}

export class EventEmitterHandle<R> extends ObjectHandle<EventEmitter<R>> {
  constructor(objectId: number, evaluator: VSCodeEvaluator) {
    super(objectId, evaluator);
  }

  async addListener(e: (event: R) => any) {
    await this._evaluator.addListener(this.objectId, e);
  }

  async removeListener(e: (event: R) => any) {
    await this._evaluator.removeListener(this.objectId, e);
  }
}
