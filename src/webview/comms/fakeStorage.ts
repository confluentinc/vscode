import { WebviewStorage } from "./comms";

export class FakeWebviewStorage<T> implements WebviewStorage<T> {
  private storage: T | undefined;

  get(): T | undefined {
    return this.storage;
  }

  set(state: T): void {
    this.storage = state;
  }
}

export function createFakeWebviewStorage<T>(): WebviewStorage<T> {
  return new FakeWebviewStorage<T>();
}
