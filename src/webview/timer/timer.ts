import { ObservableScope } from "inertial";

// run 1/5th of a second interval to refresh the screen
const TIMER_REFRESH_RATE = 5;
const SECOND = 1000;

export class Timer extends HTMLElement {
  os = ObservableScope();
  now = this.os.observe(Date.now, (cb) => {
    let timer = setInterval(cb, SECOND / TIMER_REFRESH_RATE);
    return () => clearInterval(timer);
  });
  timer = this.os.signal<{ start: number; offset: number } | null>(null, (a, b) => {
    return a == null || b == null ? a === b : a.start === b.start && a.offset === b.offset;
  });
  timerState = this.os.signal<"running" | "paused" | null>(null);
  shadowRoot = this.attachShadow({ mode: "open" });

  set time(timer: { start: number; offset: number } | null) {
    this.timer(timer);
  }

  set state(state: "running" | "paused" | null) {
    this.timerState(state);
  }

  connectedCallback() {
    const format = (value: number) => value.toString().padStart(2, "0");
    this.os.watch(() => {
      const now = this.now();
      const timer = this.timer();
      const state = this.timerState();
      if (timer == null) return;
      const elapsed = state === "running" ? now - timer.start + timer.offset : timer.offset;
      const total = Math.floor(elapsed / 1000);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = Math.floor((total % 3600) % 60);
      this.shadowRoot.innerHTML =
        hours > 0
          ? `${format(hours)}:${format(minutes)}:${format(seconds)}`
          : minutes >= 0 && seconds >= 0
            ? `${format(minutes)}:${format(seconds)}`
            : "00:00";
    });
  }

  disconnectedCallback() {
    this.os.dispose();
  }
}
