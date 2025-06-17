import { createServer } from "http";
import { AddressInfo } from "net";
import * as vscode from "vscode";
import { WebSocket, WebSocketServer } from "ws";
import {
  MessageRequestDataMap,
  MessageResponseDataMap,
  RequestMessage,
  VSCodeHandleObject,
} from "../protocol";

class VSCodeTestServer {
  private _ws: WebSocket;
  private _lastObjectId = 0;
  private _objectsById = new Map<number, any>([[0, vscode]]);
  private _idByObjects = new Map<any, number>([[vscode, 0]]);
  private _eventEmitters = new Map<number, vscode.Disposable & { listenerCount: number }>();

  constructor(ws: WebSocket) {
    this._ws = ws;
  }

  async run() {
    const cleanup = () => {
      console.log("[DEBUG] Starting WebSocket cleanup...");
      this.dispose();
      console.log("[DEBUG] WebSocket cleanup completed");
    };

    // Handle various termination signals
    process.on("SIGTERM", () => {
      console.log("[DEBUG] Received SIGTERM signal");
      cleanup();
    });
    process.on("SIGINT", () => {
      console.log("[DEBUG] Received SIGINT signal");
      cleanup();
    });
    process.on("SIGHUP", () => {
      console.log("[DEBUG] Received SIGHUP signal");
      cleanup();
    });

    await Promise.all([
      // returning from run() will kill vscode before electron.close(), so we need to hang it until process exit
      new Promise((resolve) => {
        process.on("exit", () => {
          console.log("[DEBUG] Process exit event received");
          cleanup();
          resolve(undefined);
        });
      }),
      new Promise<void>((resolve, reject) => {
        console.log("[DEBUG] Setting up WebSocket event handlers");
        this._ws.on("message", (data) => {
          console.log("[DEBUG] WebSocket message received");
          this._handleMessage(JSON.parse(data.toString()));
        });
        this._ws.on("error", (error) => {
          console.error("[DEBUG] WebSocket error:", error);
          reject(error);
        });
        this._ws.on("close", () => {
          console.log("[DEBUG] WebSocket close event received");
          cleanup();
          resolve();
        });
      }),
    ]);
  }

  dispose() {
    this._ws.close();
    const emitters = this._eventEmitters.values();
    this._eventEmitters.clear();
    for (const emitter of emitters) emitter.dispose();
  }

  private _handleMessage({ op, id, data }: RequestMessage) {
    switch (op) {
      case "release":
        this._release(id, data);
        return;
      case "registerEvent":
        this._registerEvent(id, data);
        return;
      case "unregisterEvent":
        this._unregisterEvent(id, data);
        return;
      case "invokeMethod":
        this._invokeMethod(id, data as MessageRequestDataMap["invokeMethod"]).catch(() => {});
    }
  }

  private async _invokeMethod(
    id: number,
    { objectId, fn, params, returnHandle }: MessageRequestDataMap["invokeMethod"],
  ) {
    const context = !objectId ? vscode : this._objectsById.get(objectId);
    if (!context) throw new Error(`No object with ID ${objectId} found`);

    const func = new Function(`return ${fn}`)();
    let result: any;
    let error: any;

    try {
      result = await func(context, ...this._fromParam(params));
      if (returnHandle) {
        let objectId = this._idByObjects.get(result);
        if (objectId === undefined) {
          objectId = ++this._lastObjectId;
          this._objectsById.set(objectId, result);
          this._idByObjects.set(result, objectId);
          if (result instanceof vscode.EventEmitter) {
            const { dispose } = result.event((e) => this._emit(objectId, e));
            this._eventEmitters.set(objectId, { dispose, listenerCount: 0 });
            result = { __vscodeHandle: "eventEmitter", objectId } satisfies VSCodeHandleObject;
          } else {
            result = { __vscodeHandle: true, objectId } satisfies VSCodeHandleObject;
          }
        }
      }
    } catch (e) {
      error = {
        message: e.message ?? e.toString(),
        stack: e.stack,
      };
    }
    this._send("invokeMethod", id, { result, error });
  }

  private _unregisterEvent(id: number, { objectId }: { objectId?: number }) {
    const event = this._eventEmitters.get(objectId);
    if (event && event.listenerCount > 0) event.listenerCount--;
    this._send("unregisterEvent", id);
  }

  private _registerEvent(id: number, { objectId }: { objectId?: number }) {
    const event = this._eventEmitters.get(objectId);
    if (event) event.listenerCount++;
    this._send("registerEvent", id);
  }

  private _release(id: number, { objectId, dispose }: { objectId?: number; dispose?: boolean }) {
    const obj = this._objectsById.get(objectId);
    if (obj !== undefined) {
      this._objectsById.delete(objectId);
      this._idByObjects.delete(obj);
      this._eventEmitters.get(objectId)?.dispose();
      this._eventEmitters.delete(objectId);
      if (dispose) obj.dispose?.();
    }
    this._send("release", id);
  }

  private _fromParam(param: any): any {
    if (["string", "number", "boolean", "null", "undefined"].includes(typeof param)) return param;
    if (param.__vscodeHandle) return this._objectsById.get(param.objectId);
    if (Array.isArray(param)) return param.map((v) => this._fromParam(v));
    return Object.fromEntries(Object.entries(param).map(([k, v]) => [k, this._fromParam(v)]));
  }

  private _emit(objectId: number, event: any) {
    if (this._eventEmitters.get(objectId)?.listenerCount)
      this._send("dispatchEvent", undefined, { objectId, event });
  }

  private _send<K extends keyof MessageResponseDataMap>(
    op: K,
    id: number | undefined,
    data?: MessageResponseDataMap[K],
  ) {
    this._ws.send(JSON.stringify({ op, id, data }));
  }
}

export async function run() {
  const server = createServer();
  const wsServer = new WebSocketServer({ server });
  try {
    await new Promise<void>((r) => server.listen(0, r));
    const address = server.address() as AddressInfo;
    process.stderr.write(`VSCodeTestServer listening on http://localhost:${address.port}\n`);
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      wsServer.once("connection", resolve);
      wsServer.once("error", reject);
    });
    const testServer = new VSCodeTestServer(ws);
    await testServer.run();
  } finally {
    wsServer.close();
    server.close();
  }
}
