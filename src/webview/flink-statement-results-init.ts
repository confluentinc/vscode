import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { FlinkStatementResultsViewModel } from "./flink-statement-results";
import { Timer } from "./timer/timer";

customElements.define("flink-timer", Timer);

addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const timestamp = os.produce(Date.now(), (ts, signal) => {
    function handle(event: MessageEvent<any[]>) {
      if (event.data[0] === "Timestamp") ts(Date.now());
    }
    addEventListener("message", handle, { signal });
  });

  const vm = new FlinkStatementResultsViewModel(os, timestamp);
  applyBindings(ui, os, vm);
});
