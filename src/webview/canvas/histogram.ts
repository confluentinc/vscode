import { scaleLinear, scaleUtc } from "d3-scale";
import { max } from "d3-array";
import { utcFormat } from "d3-time-format";
import { ObservableScope } from "inertial";

import { stage, observeCustomProperty, observePointer } from "./canvas";
import { track } from "./track";

export type HistogramBin = { x0: number; x1: number; total: number; filter: number | null };

/** Component that renders a basic histogram. */
export class Histogram extends HTMLElement {
  private os = ObservableScope();
  private histogram = this.os.signal<HistogramBin[] | null>([]);
  private dispose = () => {};

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
      z-index: 10;
    `;
    container.append(tooltip);

    // dynamically acquiring necessary colors from vscode webview environment
    // to make histogram consistent with the user's selected theme
    const accentColor = observeCustomProperty(os, document.documentElement, "--vscode-charts-blue");
    const foregroundColor = observeCustomProperty(
      os,
      document.documentElement,
      "--vscode-foreground",
    );

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
      context.globalAlpha = 0.1;
      for (let index = 0; index < bins.length; index++) {
        const bin = bins[index];
        context.fillRect(
          sx(bin.x0),
          sy(sy.domain()[1]),
          sx(bin.x1) - sx(bin.x0) - 1,
          sy(sy.domain()[0]),
        );
      }

      // rendering `total` values of bins
      // if filtered values exist, this rect should have transparency
      context.globalAlpha = bins.length > 0 && bins[0].filter == null ? 1 : 0.25;
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

    os.watch(() => {
      const context = interactivityStage.context();
      const { width, height } = interactivityStage.size();
      const { over, x, y } = pointer();

      const fcolor = foregroundColor();
      const sx = scaleX();
      const sy = scaleY();
      const bins = histogram();

      // using x scale, convert current pointer position to time
      // so we can find matching bin in that area of the canvas
      const time = sx.invert(x);
      const bin = bins.find((bin) => time.valueOf() >= bin.x0! && time.valueOf() <= bin.x1!);

      // if the pointer is over the canvas and bin is found, render the details tooltip
      if (over && bin != null) {
        const viewTimeFormat = utcFormat("%Y-%m-%d %H-%M-%S");
        tooltip.style.display = "block";
        tooltip.style.top = y + 5 + "px";
        if (x / width > 0.75) {
          tooltip.style.right = width - x + 5 + "px";
          tooltip.style.left = "unset";
        } else {
          tooltip.style.right = "unset";
          tooltip.style.left = x + 5 + "px";
        }
        const count =
          bin.filter != null ? `Count: ${bin.total}, filter: ${bin.filter}` : `Count: ${bin.total}`;
        tooltip.textContent = `From: ${viewTimeFormat(new Date(bin.x0!))}\nTo: ${viewTimeFormat(new Date(bin.x1!))}\n${count}`;
      } else {
        tooltip.style.display = "none";
      }

      interactivityStage.canvas.style.cursor = "crosshair";

      context.clearRect(0, 0, width, height);
      context.save();
      // when hovering, also render a rect over the found one to highlight it
      if (over && bin != null) {
        const x = sx(bin.x0!);
        const y = sy(bin.total);
        const w = sx(bin.x1!) - sx(bin.x0!) - 1;
        const h = sy(sy.domain()[0]) - sy(bin.total);
        context.globalAlpha = 0.75;
        context.fillStyle = fcolor;
        context.fillRect(x, y, w, h);
      }
      context.restore();
    });
  }

  disconnectedCallback() {
    this.dispose();
  }
}
