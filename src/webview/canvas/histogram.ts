import { scaleLinear, scaleUtc } from "d3-scale";
import { max, bisector } from "d3-array";
import { ObservableScope } from "inertial";

import { stage, observeCustomProperty, observePointer } from "./canvas";
import { brush } from "./brush";
import { track } from "./track";

export type HistogramBin = { x0: number; x1: number; total: number; filter: number | null };

/** Component that renders a basic histogram. */
export class Histogram extends HTMLElement {
  private os = ObservableScope();
  private histogram = this.os.signal<HistogramBin[] | null>([]);
  private selection = this.os.signal<[number, number] | null>(null, (a, b) => {
    if (a == null || b == null) return a === b;
    return a[0] === b[0] && a[1] === b[1];
  });
  private dispose = () => {};

  /** Update `select` property of an element to provide selected range of data. */
  set select(value: [number, number] | null) {
    this.selection(value);
  }

  /** Update `data` property of an element to provide histogram data. */
  set data(value: HistogramBin[] | null) {
    this.histogram(value);
  }

  /**
   * This is a lifecycle method of a custom element that is invoked when the
   * element is added to the page.
   */
  connectedCallback() {
    const shadowRoot = this.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    container.style.cssText = "position: relative; width: 100%; height: 100%;";
    shadowRoot.append(container);

    // just an alias
    const os = this.os;
    // viz stage is the one that renders when new data is provided
    const visualizationStage = stage(os, container);
    // top level stage that re-renders frequently to respond to user input
    const interactivityStage = stage(os, container);
    // when the element is removed from the page, dispose resources
    this.dispose = () => {
      visualizationStage.canvas.remove();
      interactivityStage.canvas.remove();
      os.dispose();
    };

    // this tooltip is used for outputting currently hovered bin's information
    const tooltip = document.createElement("div");
    tooltip.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: none;
      white-space: pre;
      padding: 0.5rem 0.75rem;
      pointer-events: none;
      border: 1px solid var(--focus-border);
      font-size: var(--vscode-font-size);
      z-index: 10;
    `;
    container.append(tooltip);

    // dynamically acquiring necessary colors from vscode webview environment
    // to make histogram consistent with the user's selected theme
    const root = document.documentElement;
    const accentColor = observeCustomProperty(os, root, "--vscode-charts-blue");
    const foregroundColor = observeCustomProperty(os, root, "--vscode-foreground");
    const brushColor = observeCustomProperty(os, root, "--vscode-charts-foreground");

    const pointer = observePointer(os, interactivityStage.canvas);

    // a fallback to the actual histogram to simplify certain conditions
    const histogram = os.derive(() => {
      return this.histogram() ?? [];
    });

    // x scale is a UTC time scale that follows domain extent provided by the histogram
    const scaleX = os.derive(() => {
      const { width } = visualizationStage.size();
      const bins = histogram();
      const xd = bins.length > 0 ? [bins[0].x0!, bins[bins.length - 1].x1!] : [0, 0];
      const x = scaleUtc(xd, [0, width]);
      return x;
    });

    // the histogram is split into 2 sections with static space for the bottom axis
    const trackY = os.derive(() => {
      const { height } = visualizationStage.size();
      return track(["1f", "15u"], height, 0, 10);
    });
    // y scale for the histogram only has domain of [0, highest bin's total]
    const scaleY = os.derive(() => {
      const ty = trackY();
      const bins = histogram();
      const yd = bins.length > 0 ? [0, max(bins, (bin) => bin.total)!] : [0, 0];
      const y = scaleLinear(yd, ty(0).reverse() as [number, number]);
      return y;
    });

    os.watch(() => {
      const context = visualizationStage.context();
      const { width, height } = visualizationStage.size();
      const bins = histogram();

      const sx = scaleX();
      const sy = scaleY();
      const ty = trackY();

      const acolor = accentColor();
      const fcolor = foregroundColor();

      context.clearRect(0, 0, width, height);
      context.save();

      // rendering bottom axis
      if (bins.length > 0) {
        let sy2 = scaleLinear([0, 1], ty(1));
        context.fillStyle = fcolor;
        let tickcount = 10;
        let timeticks = sx.ticks(tickcount);
        let format = sx.tickFormat(tickcount);
        let hair = 5;
        for (let tick of timeticks) {
          context.fillRect(sx(tick) - 1, sy2(0) - hair - 2, 1, hair);
          context.textBaseline = "top";
          context.textAlign = "center";
          context.fillText(format(tick), sx(tick), sy2(0));
        }
      }

      context.fillStyle = acolor;

      // rendering background rects for each bin
      for (let index = 0; index < bins.length; index++) {
        const bin = bins[index];
        // adding a slight shade to the bins that got filter > 0 in case the value is too small to notice
        context.globalAlpha = bin.filter == null || bin.filter === 0 ? 0.1 : 0.15;
        context.fillRect(
          sx(bin.x0),
          sy(sy.domain()[1]),
          sx(bin.x1) - sx(bin.x0) - 1,
          sy(sy.domain()[0]),
        );
      }

      // rendering `total` values of bins
      // if filtered values exist, this rect should have transparency
      context.globalAlpha = bins.length > 0 && bins[0].filter == null ? 1 : 0.3;
      for (let index = 0; index < bins.length; index++) {
        const bin = bins[index];
        context.fillRect(
          sx(bin.x0),
          sy(bin.total),
          sx(bin.x1) - sx(bin.x0) - 1,
          sy(sy.domain()[0]) - sy(bin.total),
        );
      }

      // if filtered values exists, render them on top
      context.globalAlpha = 1;
      for (let index = 0; index < bins.length; index++) {
        const bin = bins[index];
        if (bin.filter == null) break;
        context.fillRect(
          sx(bin.x0),
          sy(bin.filter),
          sx(bin.x1) - sx(bin.x0) - 1,
          sy(sy.domain()[0]) - sy(bin.filter),
        );
      }

      context.restore();
    });

    // mutable state that handles all the math related to positioning the brushing rectangle
    const brushX = brush("x");

    os.watch(() => {
      const { width } = interactivityStage.size();
      const ty = trackY();
      const [h0, h1] = ty(0);
      // setting the boundary in which the brushing is available
      brushX.extent([
        [0, h0],
        [width, h1],
      ]);
      // either when selection is changed by other source or by the physical size change itself,
      // the current brush state also need to be adjusted
      let selection = this.selection();
      let sx = scaleX();
      if (selection != null) {
        let [a, b] = selection;
        brushX.set([
          [sx(a), h0],
          [sx(b), h1],
        ]);
      } else brushX.set(null);
    });

    const bisectBin = bisector((bin: HistogramBin) => bin.x1);

    // using mutable state to identify whether a sequence of event was just a tap or an actual brushing
    let pointerMoved = false;
    os.watch(() => {
      const { down, x, y, shiftKey } = pointer();
      const sx = scaleX();
      const bins = histogram();
      if (brushX.idle() && down) {
        // initiate brushing gesture
        brushX.down(x, y);
        pointerMoved = false;
      } else if (!brushX.idle() && down) {
        // if brushing was initiated and the pointer is still pressed,
        // then we may assume it was a move event that updates selection
        pointerMoved = true;
        brushX.move(x, y);
        const currentRange = brushX.get()!;
        let lo = sx.invert(currentRange[0][0]).valueOf();
        let hi = sx.invert(currentRange[1][0]).valueOf();
        if (shiftKey && bins.length > 0) {
          const loi = Math.max(0, bisectBin.left(bins, lo));
          const hii = Math.min(bisectBin.right(bins, hi), bins.length - 1);
          lo = bins[loi].x0;
          hi = bins[hii].x1;
        }
        this.selection([lo, hi]);
      } else if (!brushX.idle() && !down) {
        brushX.up();
        // if the pointer is released but no moving was done, clear the selection
        if (!pointerMoved) {
          brushX.set(null);
          this.selection(null);
        }
      }
      // TODO make default cursor if the pointer is outside of the actual histogram area
      // update cursor style based on current pointer position over a brushed area
      interactivityStage.canvas.style.cursor = brushX.cursor(x, y);
    });

    // dispatch an event, so the parent element can subscribe to selection change
    let first = true;
    os.watch(() => {
      const detail = this.selection();
      // the flag prevents unnecessary dispatch on the very first render
      if (!first) this.dispatchEvent(new CustomEvent("select", { detail }));
      first = false;
    });

    os.watch(() => {
      const context = interactivityStage.context();
      const { width, height } = interactivityStage.size();
      const { down, over, x, y } = pointer();

      const fcolor = foregroundColor();
      const bcolor = brushColor();
      const sx = scaleX();
      const sy = scaleY();
      const bins = histogram();
      const selection = this.selection();

      // using x scale, convert current pointer position to time
      // so we can find matching bin in that area of the canvas
      const time = sx.invert(x);
      const binIndex = bisectBin.left(bins, time.valueOf());
      const bin = binIndex >= 0 ? bins[binIndex] : null;
      const rightInclusive = binIndex === bins.length - 1;

      // if the pointer is over the canvas and bin is found, render the details tooltip
      if (over && bin != null) {
        tooltip.style.display = "block";
        tooltip.style.top = y + 5 + "px";
        if (x / width > 0.75) {
          tooltip.style.right = width - x + 5 + "px";
          tooltip.style.left = "unset";
        } else {
          tooltip.style.right = "unset";
          tooltip.style.left = x + 5 + "px";
        }
        if (down && selection != null) {
          tooltip.innerHTML = `<label>Selected range</label><br><code>${new Date(selection[0]).toISOString()}</code><br><code>${new Date(selection[1]).toISOString()}</code>`;
        } else {
          const count =
            bin.filter != null
              ? `Total: <strong>${bin.total.toLocaleString()}</strong> Filter: <strong>${bin.filter.toLocaleString()}</strong>`
              : `Total: <strong>${bin.total.toLocaleString()}</strong>`;
          const content = [
            `<div style="display: flex; flex-direction: column; gap: 0.5rem">`,
            `<label>From (inclusive)<br><code>${new Date(bin.x0!).toISOString()}</code></label>`,
            `<label>To (${rightInclusive ? "inclusive" : "exclusive"}) <br><code>${new Date(bin.x1!).toISOString()}</code></label>`,
            `<span>${count}</span>`,
            `</div>`,
          ];
          tooltip.innerHTML = content.join("");
        }
      } else {
        tooltip.style.display = "none";
      }

      context.clearRect(0, 0, width, height);
      context.save();
      // when hovering, also render a rect over the found one to highlight it
      // but don't rendering while brushing
      if (!down && over && bin != null) {
        const x = sx(bin.x0!);
        const y = sy(bin.total);
        const w = sx(bin.x1!) - sx(bin.x0!) - 1;
        const h = sy(sy.domain()[0]) - sy(bin.total);
        context.globalAlpha = 0.75;
        context.fillStyle = fcolor;
        context.fillRect(x, y, w, h);
      }

      // render a rectangle that shows currently selected time frame
      if (selection != null) {
        const lo = sx(selection[0]);
        const hi = sx(selection[1]);
        const h = sy(sy.domain()[0]);
        // if the cursor is currently over the histogram,
        // make it a bit easier to hover over the bins
        context.globalAlpha = over ? 0.25 : 0.35;
        context.fillStyle = bcolor;
        context.fillRect(lo, 0, hi - lo, h);
        // when hovering, add border to the brushing rect for contrast
        if (over) {
          context.globalAlpha = 0.35;
          context.strokeRect(lo, 0, hi - lo, h);
        }
      }
      context.restore();
    });
  }

  disconnectedCallback() {
    this.dispose();
  }
}
