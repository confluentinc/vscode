import { type Scope } from "inertial";

/**
 * A base class for creating view models: objects that contain reactive values
 * and related logic. It inlines observable scope's methods from inertial lib
 * to the object context to make it slightly easier to write new VMs.
 *
 * @example
 * ```ts
 * class CounterViewModel extends ViewModel {
 *   counter = this.signal(0);
 *
 *   isGreaterThanZero = this.derive(() => {
 *     return this.counter() > 0;
 *   });
 *
 *   increment() {
 *     this.counter(value => value + 1);
 *   }
 * }
 *
 * const os = ObservableScope();
 * const vm = new CounterViewModel(os);
 * ```
 *  */
export class ViewModel implements Scope {
  observe!: Scope["observe"];
  signal!: Scope["signal"];
  derive!: Scope["derive"];
  watch!: Scope["watch"];
  peek!: Scope["peek"];
  batch!: Scope["batch"];
  deref!: Scope["deref"];
  dispose!: Scope["dispose"];
  constructor(os: Scope) {
    Object.assign(this, os);
  }

  /**
   * Provides derive()-like signal that resolves a promise value before
   * updating dependants.
   *
   * @example
   * ```ts
   * class MyVM extends ViewModel {
   *   online = this.observe(
   *     () => navigator.onLine,
   *     (cb) => {
   *       addEventListener("offline", cb);
   *       return () => removeEventListener("offline", cb);
   *     },
   *   );
   *
   *   data = this.resolve(async () => {
   *     if (this.online()) {
   *       const response = await fetch("/data")
   *       return response.json();
   *     }
   *     return [];
   *   }, [])
   * }
   * ```
   */
  resolve<Result>(fn: () => Promise<Result>, init: Result) {
    const result = this.signal<Result>(init);
    // XXX this function should remain synchronous, per `watch()` requirement
    this.watch(() => {
      // local abort controller prevents race conditions:
      // if an older async request takes longer to resolve, its result should be dismissed
      const ctl = new AbortController();
      fn().then((value) => {
        if (!ctl.signal.aborted) result(value);
      });
      // if the watcher needs to rerun: abort currently pending update
      return () => ctl.abort();
    });
    return result;
  }
}
